#!/usr/bin/env node
/**
 * After `make observability-correctness-metrics`, fail if formal trace / SLA / DCI policy is not met.
 * Intended for: PREFLIGHT_REQUIRE_FORMAL_TRACE_GATES=1 (see Makefile _preflight-lab-inner).
 *
 * Env:
 *   OCH_FORMAL_REQUIRE_TRACE=1 (default) — trace-ltl / model / temporal must not be skipped
 *   OCH_DCI_MIN — must match distributed-correctness-index (default 90)
 *   OCH_SLA_SCORE_MIN — must match sla-resilience-score (default 0.85)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const BENCH = join(REPO, "bench_logs");

function loadJson(rel, fb) {
  const p = join(BENCH, rel);
  if (!existsSync(p)) return fb;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
}

function fail(msg) {
  console.error(`preflight-formal-gates-enforce: FAIL — ${msg}`);
  process.exit(1);
}

function main() {
  const requireTrace = process.env.OCH_FORMAL_REQUIRE_TRACE !== "0";
  const dciMin = Number(process.env.OCH_DCI_MIN || "90");
  const slaMin = Number(process.env.OCH_SLA_SCORE_MIN || "0.85");
  const tracePath = join(BENCH, "trace_contract.json");

  const dci = loadJson("dci-report.json", null);
  if (!dci) fail("missing bench_logs/dci-report.json (run observability-correctness-metrics)");
  if (!dci.compliant) fail(`DCI ${dci.dci} < floor ${dci.min ?? dciMin}`);

  if (requireTrace && !existsSync(tracePath)) fail("missing bench_logs/trace_contract.json (export Jaeger trace after Step7)");

  const ltl = loadJson("trace-ltl-report.json", {});
  if (requireTrace && ltl.skipped) fail("trace LTL skipped — trace_contract.json unreadable or empty");
  if (ltl.ok === false) fail(`LTL violations: ${JSON.stringify(ltl.violations || [])}`);

  const model = loadJson("trace-model-check-report.json", {});
  if (requireTrace && model.skipped) fail("trace model-check skipped — need bench_logs/trace_contract.json");
  if (model.ok === false) fail(`unexpected service cycles: ${JSON.stringify(model.unexpected_cycles || [])}`);

  const temporal = loadJson("trace-temporal-report.json", { ok: true });
  if (requireTrace && temporal.reason === "no_spans") fail("trace temporal: no spans in trace_contract.json");
  if (temporal.ok === false) fail(`temporal invariant violations: ${JSON.stringify(temporal.violations || [])}`);

  const sla = loadJson("sla-resilience-score.json", {});
  if (sla.compliant === 0 || (sla.score != null && sla.score < slaMin)) {
    fail(`SLA resilience not compliant (score=${sla.score}, min=${slaMin})`);
  }

  console.error("preflight-formal-gates-enforce: OK");
  process.exit(0);
}

main();
