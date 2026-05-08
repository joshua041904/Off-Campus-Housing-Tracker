#!/usr/bin/env node
/**
 * CLI: sample recent Jaeger traces and report service-chain + overlap diagnostics.
 *
 *   JAEGER_QUERY_BASE=http://127.0.0.1:16686 node scripts/trace-validators/check-trace-continuity.mjs
 *
 * Env:
 *   STEP7_SEED_SERVICE (default api-gateway)
 *   STEP7_LOOKBACK_SEC (default 900)
 *   STEP7_TRACE_LIMIT (default 30)
 *   STEP7_REQUIRED_SERVICES — comma list (default api-gateway,auth-service,listings-service)
 *
 * Flags:
 *   --strict-trace-id — require all Jaeger spans to share the same traceID as the trace root
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTracesUrl, fetchJson, normalizeTrace } from "./lib/jaeger-traces.mjs";
import { diagnoseServiceChain, validateSingleTraceIdConsistency } from "./trace-service-continuity.mjs";

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
      "Usage: JAEGER_QUERY_BASE=http://host:16686 node scripts/trace-validators/check-trace-continuity.mjs [--report-dir DIR] [--require-full-chain]",
    );
    process.exit(1);
  }
  const base = process.env.JAEGER_QUERY_BASE?.replace(/\/$/, "");
  if (!base) {
    console.error("JAEGER_QUERY_BASE is required");
    process.exit(2);
  }
  const reportDir = getArg(argv, "--report-dir", join(process.cwd(), "bench_logs/step7-observability"));
  const requireFull = hasFlag(argv, "--require-full-chain");
  const strictTraceId = hasFlag(argv, "--strict-trace-id");
  const lookback = Number(process.env.STEP7_LOOKBACK_SEC || "900");
  const limit = Number(process.env.STEP7_TRACE_LIMIT || "30");
  const seed = process.env.STEP7_SEED_SERVICE || "api-gateway";
  const required = (process.env.STEP7_REQUIRED_SERVICES || "api-gateway,auth-service,listings-service")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const url = buildTracesUrl(base, seed, lookback, limit);
  const data = await fetchJson(url);
  const traces = data.data || [];

  let best = null;
  const samples = [];
  for (const raw of traces) {
    const trace = normalizeTrace(raw);
    if (!trace?.spans?.length) continue;
    const d = diagnoseServiceChain(trace, required);
    const tid = validateSingleTraceIdConsistency(trace);
    samples.push(Object.assign({}, d, { traceIdConsistency: tid }));
    const chainOk = d.missing.length === 0;
    const tidOk = !strictTraceId || tid.ok;
    if (chainOk && d.overlap && tidOk) {
      best = { status: "PASS", ...d, traceIdConsistency: tid };
      break;
    }
    if (!best || d.missing.length < (best.missing?.length ?? 99)) {
      best = { status: chainOk ? "PARTIAL" : "FAIL", ...d, traceIdConsistency: tid };
    }
  }

  const out = {
    seed,
    required,
    requireFullChain: requireFull,
    best,
    samples: samples.slice(0, 12),
    timestamp: new Date().toISOString(),
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "trace-continuity-check.json"), `${JSON.stringify(out, null, 2)}\n`);

  const pass =
    best &&
    best.missing.length === 0 &&
    (!requireFull || best.overlap) &&
    (!strictTraceId || best.traceIdConsistency?.ok);
  console.log(JSON.stringify({ ok: pass, ...out.best }, null, 2));
  if (!pass) {
    if (strictTraceId && best && !best.traceIdConsistency?.ok) {
      console.error("trace-continuity: FAIL — traceID consistency:", best.traceIdConsistency?.violations);
    } else if (requireFull && best && !best.overlap) {
      console.error("trace-continuity: FAIL — required overlap not found (concurrent spans)");
    } else {
      console.error("trace-continuity: FAIL — missing services:", best?.missing);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
