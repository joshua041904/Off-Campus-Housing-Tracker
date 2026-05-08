#!/usr/bin/env node
/**
 * Time-window correlation: QUIC capture (transport-summary-v7.json) vs Jaeger traces.
 *
 * Usage:
 *   node scripts/verify-quic-jaeger-correlation.mjs --v7-json path/to/transport-summary-v7.json [--write-back] [--require-correlation]
 *     [--require-overlap] [--min-trace-ids N]  (load-phase transport study: spans must intersect capture_window)
 *
 * Env:
 *   JAEGER_QUERY_BASE — e.g. http://127.0.0.1:16686 (required to query)
 *   QUIC_JAEGER_CORRELATION_REQUIRE=1 — exit 1 if no suitable trace (optional; --require-correlation same)
 *   QUIC_JAEGER_CORRELATION_LOOKBACK_SEC — extend Jaeger query start before capture start (default 900; suites run before standalone capture)
 *   QUIC_JAEGER_MIN_TRACE_IDS — minimum gateway+upstream traces (default 1 when --min-trace-ids omitted)
 */
import { readFileSync, writeFileSync } from "node:fs";

function getArg(argv, name, def = undefined) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (typeof v === "string" && v.startsWith("-")) return def;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function usage() {
  console.error(`Usage:
  JAEGER_QUERY_BASE=http://host:16686 node scripts/verify-quic-jaeger-correlation.mjs --v7-json FILE [--write-back] [--require-correlation]
    [--require-overlap] [--min-trace-ids N]
`);
}

function normalizeBase(base) {
  if (!base) return "";
  return String(base).replace(/\/+$/, "");
}

function toMicros(epoch) {
  const n = Number(epoch);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n * 1_000_000);
}

function serviceNamesFromTrace(trace) {
  const processes = trace.processes || {};
  const names = new Set();
  for (const sp of trace.spans || []) {
    const pid = sp.processID;
    const p = processes[pid];
    const sn = p?.serviceName;
    if (sn) names.add(sn);
  }
  return [...names];
}

/** Span interval [start, end) in microseconds intersects [cwStart, cwEnd] inclusive-ish */
function spanOverlapsCapture(span, cwStart, cwEnd) {
  const s = Number(span.startTime);
  const d = Number(span.duration) || 0;
  if (!Number.isFinite(s)) return false;
  const e = s + d;
  return e >= cwStart && s <= cwEnd;
}

function traceOverlapsCaptureWindow(trace, cwStartUs, cwEndUs) {
  const spans = trace.spans || [];
  for (const sp of spans) {
    if (spanOverlapsCapture(sp, cwStartUs, cwEndUs)) return true;
  }
  return false;
}

function traceHasGatewayAndUpstream(names) {
  const lower = names.map((n) => n.toLowerCase());
  const gw = lower.some((n) => n.includes("api-gateway") || n === "api-gateway");
  if (!gw) return false;
  const upstream = lower.some(
    (n) =>
      n.includes("listings") ||
      n.includes("booking") ||
      n.includes("auth") ||
      n.includes("messaging") ||
      n.includes("media") ||
      n.includes("trust") ||
      n.includes("analytics") ||
      n.includes("notification"),
  );
  return upstream && names.length >= 2;
}

async function fetchTracesInWindow(base, service, startMicro, endMicro, limit = 30) {
  const u = new URL("/api/traces", base);
  u.searchParams.set("service", service);
  u.searchParams.set("start", String(startMicro));
  u.searchParams.set("end", String(endMicro));
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Jaeger HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    usage();
    process.exit(0);
  }
  const v7Path = getArg(argv, "--v7-json");
  if (!v7Path) {
    usage();
    process.exit(2);
  }
  const writeBack = hasFlag(argv, "--write-back");
  const requireCorr =
    hasFlag(argv, "--require-correlation") ||
    String(process.env.QUIC_JAEGER_CORRELATION_REQUIRE || "").trim() === "1";
  const requireOverlap = hasFlag(argv, "--require-overlap");
  const requireTraceIdsFlag =
    hasFlag(argv, "--require-trace-ids") || hasFlag(argv, "--require-traceids");
  let minTraceIds = Number.parseInt(String(process.env.QUIC_JAEGER_MIN_TRACE_IDS || "1"), 10) || 1;
  const mti = getArg(argv, "--min-trace-ids");
  if (mti !== undefined) minTraceIds = Number.parseInt(String(mti), 10) || 1;
  if (requireTraceIdsFlag) minTraceIds = Math.max(minTraceIds, 1);

  let doc;
  try {
    doc = JSON.parse(readFileSync(v7Path, "utf8"));
  } catch (e) {
    console.error("verify-quic-jaeger-correlation: cannot read v7 JSON:", e?.message || e);
    process.exit(2);
  }

  const base = normalizeBase(process.env.JAEGER_QUERY_BASE || "");
  if (!base) {
    console.log("verify-quic-jaeger-correlation: JAEGER_QUERY_BASE unset — skip Jaeger correlation (ok)");
    process.exit(0);
  }

  const cw = doc.capture_window || {};
  const startMicro = toMicros(cw.start_epoch);
  const endMicro = toMicros(cw.end_epoch);
  if (startMicro == null || endMicro == null || endMicro <= startMicro) {
    console.warn("verify-quic-jaeger-correlation: missing or invalid capture_window — cannot correlate");
    if (requireCorr || requireOverlap) process.exit(1);
    process.exit(0);
  }

  const lookbackSec = Math.max(
    0,
    Math.min(
      3600,
      Number.parseInt(String(process.env.QUIC_JAEGER_CORRELATION_LOOKBACK_SEC || "900", 10), 10) || 900,
    ),
  );
  const startExpanded = Math.max(0, startMicro - lookbackSec * 1_000_000);
  /** Pad end so traces finishing just after capture still match */
  const endPadded = endMicro + 2_000_000;

  console.log(
    `verify-quic-jaeger-correlation: Jaeger window ${lookbackSec}s lookback before capture → end+2s (µs ${startExpanded}..${endPadded})`,
  );

  let traces;
  try {
    traces = await fetchTracesInWindow(base, "api-gateway", startExpanded, endPadded);
  } catch (e) {
    console.error("verify-quic-jaeger-correlation: Jaeger query failed:", e?.message || e);
    if (requireCorr || requireOverlap) process.exit(1);
    process.exit(0);
  }

  const data = Array.isArray(traces?.data) ? traces.data : [];
  const linked = [];
  let overlapOk = false;
  for (const tr of data) {
    const names = serviceNamesFromTrace(tr);
    if (traceHasGatewayAndUpstream(names)) {
      linked.push(String(tr.traceID || ""));
      if (traceOverlapsCaptureWindow(tr, startMicro, endMicro)) overlapOk = true;
    }
  }
  const uniq = [...new Set(linked.filter(Boolean))];

  const correlation = {
    trace_ids_seen: uniq.slice(0, 20),
    jaeger_trace_linked: uniq.length >= minTraceIds,
    capture_window_overlap: overlapOk,
  };

  if (writeBack) {
    const next = { ...doc, correlation };
    writeFileSync(v7Path, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log(`verify-quic-jaeger-correlation: updated ${v7Path} (jaeger_trace_linked=${correlation.jaeger_trace_linked})`);
  } else {
    console.log(JSON.stringify({ correlation, jaeger_query_base: base }, null, 2));
  }

  if (requireCorr && !correlation.jaeger_trace_linked) {
    console.error(
      "verify-quic-jaeger-correlation: require-correlation but fewer than minTraceIds api-gateway+upstream traces in Jaeger window",
    );
    process.exit(1);
  }
  if (requireOverlap && !overlapOk) {
    console.error(
      "verify-quic-jaeger-correlation: --require-overlap but no qualifying trace had spans intersecting capture_window (epoch → µs)",
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
