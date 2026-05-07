#!/usr/bin/env node
/**
 * Compare bench_logs/bootstrap_phase_timings.json to historical snapshots (p50/p95/p99/p100).
 * Emits bench_logs/bootstrap_regression_report.json; optional FAIL_ON_REGRESSION=1 → exit 1 when any regression.
 *
 * Env:
 *   REGRESSION_THRESHOLD — multiply baseline p95 (default 1.5)
 *   REGRESSION_MIN_RUNS — minimum history files before detecting (default 3)
 *   VERIFY_BOOTSTRAP_TIMING_JSON — current timings path
 *   VERIFY_BOOTSTRAP_TIMING_HISTORY_DIR — historical JSON dir
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const currentPath =
  process.env.VERIFY_BOOTSTRAP_TIMING_JSON || join(repoRoot, "bench_logs/bootstrap_phase_timings.json");
const historyDir =
  process.env.VERIFY_BOOTSTRAP_TIMING_HISTORY_DIR || join(repoRoot, "bench_logs/historical_timings");
const reportPath = join(repoRoot, "bench_logs/bootstrap_regression_report.json");

const THRESHOLD = Number.parseFloat(process.env.REGRESSION_THRESHOLD || "1.5", 10);
const MIN_RUNS = Number.parseInt(process.env.REGRESSION_MIN_RUNS || "3", 10);

function loadHistoryRuns(dir) {
  if (!existsSync(dir)) return [];
  const runs = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let obj;
    try {
      obj = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    const ok = Object.entries(obj).every(
      ([k, v]) => typeof k === "string" && (typeof v === "number" || typeof v === "string")
    );
    if (!ok) continue;
    runs.push(obj);
  }
  return runs;
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function buildBaselines(runs) {
  const map = new Map();
  for (const run of runs) {
    for (const [phase, raw] of Object.entries(run)) {
      const t = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(t)) continue;
      if (!map.has(phase)) map.set(phase, []);
      map.get(phase).push(t);
    }
  }
  const baseline = {};
  for (const [phase, values] of map) {
    const sorted = [...values].sort((a, b) => a - b);
    baseline[phase] = {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      p100: sorted[sorted.length - 1],
      samples: sorted.length,
    };
  }
  return baseline;
}

function main() {
  mkdirSync(join(repoRoot, "bench_logs"), { recursive: true });

  if (!existsSync(currentPath)) {
    const result = { ok: true, skipped: "no_current_timings", regressions: [], currentPath };
    writeFileSync(reportPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let current;
  try {
    current = JSON.parse(readFileSync(currentPath, "utf8"));
  } catch {
    const result = { ok: true, skipped: "current_timings_invalid_json", regressions: [] };
    writeFileSync(reportPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!current || typeof current !== "object") {
    const result = { ok: true, skipped: "current_timings_not_object", regressions: [] };
    writeFileSync(reportPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const runs = loadHistoryRuns(historyDir);
  if (runs.length < MIN_RUNS) {
    const result = {
      ok: true,
      skipped: "not_enough_history",
      need_runs: MIN_RUNS,
      have_runs: runs.length,
      regressions: [],
    };
    writeFileSync(reportPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const baseline = buildBaselines(runs);
  const regressions = [];

  for (const [phase, raw] of Object.entries(current)) {
    const time = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(time)) continue;
    const base = baseline[phase];
    if (!base || !Number.isFinite(base.p95) || base.p95 <= 0) continue;
    if (time > base.p95 * THRESHOLD) {
      regressions.push({
        phase,
        current_ms: time,
        baseline_p50_ms: base.p50,
        baseline_p95_ms: base.p95,
        baseline_p99_ms: base.p99,
        baseline_p100_ms: base.p100,
        threshold: THRESHOLD,
        ratio_vs_p95: Number((time / base.p95).toFixed(3)),
      });
    }
  }

  const result = {
    ok: regressions.length === 0,
    regressions,
    threshold: THRESHOLD,
    min_runs: MIN_RUNS,
    history_runs: runs.length,
    currentPath,
    historyDir,
  };

  writeFileSync(reportPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok && process.env.FAIL_ON_REGRESSION === "1") {
    console.error(
      `detect-bootstrap-regression: ${regressions.length} phase(s) exceed p95×${THRESHOLD} — set FAIL_ON_REGRESSION=0 to ignore`
    );
    process.exit(1);
  }
}

main();
