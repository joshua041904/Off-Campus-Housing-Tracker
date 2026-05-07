#!/usr/bin/env node
/**
 * Hard proof: Jaeger trace has one trace_id across spans + required services (+ optional overlap).
 *
 *   JAEGER_QUERY_BASE=http://127.0.0.1:16686 node scripts/trace-validators/validate-trace-propagation-under-load.mjs
 *
 * Env:
 *   TRACE_PROPAGATION_PROOF_TRACE_ID — if set, fetch this trace only (32 hex, case-insensitive)
 *   STEP7_SEED_SERVICE (default api-gateway) — used when polling list API
 *   STEP7_LOOKBACK_SEC STEP7_TRACE_LIMIT
 *   STEP7_REQUIRED_SERVICES — comma list (default api-gateway,auth-service,listings-service)
 *   STEP7_TRACE_PROOF_REQUIRE_OVERLAP=1 — also require trace-overlap-validator OK
 *   STEP7_REQUIRE_NET_PROTO=1 — every span must have tag net.proto
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTracesUrl, fetchJson, fetchTraceById, normTraceId, normalizeTrace } from "./lib/jaeger-traces.mjs";
import { diagnoseServiceChain, validateSingleTraceIdConsistency } from "./trace-service-continuity.mjs";
import { validateOverlapInvariant } from "./trace-overlap-validator.mjs";
import { traceSpansHaveNetProto } from "./step7-strict-span-invariant.mjs";

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (String(v).startsWith("-")) return def;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    console.error(
      "Usage: JAEGER_QUERY_BASE=http://host:16686 node scripts/trace-validators/validate-trace-propagation-under-load.mjs [--report-dir DIR] [--trace-id HEX]",
    );
    process.exit(1);
  }
  const base = process.env.JAEGER_QUERY_BASE?.replace(/\/$/, "");
  if (!base) {
    console.error("JAEGER_QUERY_BASE is required");
    process.exit(2);
  }
  const reportDir = getArg(argv, "--report-dir", join(process.cwd(), "bench_logs/step7-observability"));
  const argTid = getArg(argv, "--trace-id", process.env.TRACE_PROPAGATION_PROOF_TRACE_ID || "");
  const lookback = Number(process.env.STEP7_LOOKBACK_SEC || "900");
  const limit = Number(process.env.STEP7_TRACE_LIMIT || "40");
  const seed = process.env.STEP7_SEED_SERVICE || "api-gateway";
  const required = (process.env.STEP7_REQUIRED_SERVICES || "api-gateway,auth-service,listings-service")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const requireOverlap = process.env.STEP7_TRACE_PROOF_REQUIRE_OVERLAP === "1";

  mkdirSync(reportDir, { recursive: true });

  let trace = null;
  let source = "";

  if (argTid) {
    trace = await fetchTraceById(base, argTid);
    source = `trace_id=${normTraceId(argTid)}`;
    if (!trace) {
      const fail = { ok: false, reason: "trace_not_found", traceId: normTraceId(argTid), source };
      writeFileSync(join(reportDir, "trace-propagation-proof.json"), `${JSON.stringify(fail, null, 2)}\n`);
      console.error(JSON.stringify(fail));
      process.exit(1);
    }
  } else {
    const url = buildTracesUrl(base, seed, lookback, limit);
    const data = await fetchJson(url);
    const traces = data.data || [];
    for (const raw of traces) {
      const t = normalizeTrace(raw);
      if (!t?.spans?.length) continue;
      const idc = validateSingleTraceIdConsistency(t);
      const diag = diagnoseServiceChain(t, required);
      const ov = requireOverlap ? validateOverlapInvariant(t, {}) : { ok: true, violations: [] };
      const np = requireNetProto ? traceSpansHaveNetProto(t) : { ok: true, violations: [] };
      if (idc.ok && diag.missing.length === 0 && ov.ok && np.ok) {
        trace = t;
        source = "poll_recent";
        break;
      }
    }
    if (!trace) {
      const fail = { ok: false, reason: "no_trace_passed_filters", source: "poll_recent", required };
      writeFileSync(join(reportDir, "trace-propagation-proof.json"), `${JSON.stringify(fail, null, 2)}\n`);
      console.error(JSON.stringify(fail));
      process.exit(1);
    }
  }

  const idc = validateSingleTraceIdConsistency(trace);
  const diag = diagnoseServiceChain(trace, required);
  const overlap = validateOverlapInvariant(trace, {});
  const netProto = requireNetProto ? traceSpansHaveNetProto(trace) : { skipped: true };

  const out = {
    ok:
      idc.ok &&
      diag.missing.length === 0 &&
      (!requireOverlap || overlap.ok) &&
      (!requireNetProto || netProto.ok),
    traceID: trace.traceID,
    source,
    singleTraceId: idc,
    serviceChain: diag,
    overlap: requireOverlap ? overlap : { skipped: true },
    netProto: requireNetProto ? netProto : { skipped: true },
    timestamp: new Date().toISOString(),
  };

  writeFileSync(join(reportDir, "trace-propagation-proof.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
