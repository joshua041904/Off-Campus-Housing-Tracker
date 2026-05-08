#!/usr/bin/env node
/**
 * Compare current app_runtime_critical_path_ms (Prom textfile) to historical p95 from
 * bench_logs/app_runtime_history.jsonl (dag_analysis.critical_path_ms on successful runs).
 *
 * Emits: bench_logs/app_runtime_critical_path_regression_report.json
 *
 * Env:
 *   VERIFY_APP_RUNTIME_PROM_OUT — current .prom path (default bench_logs/app_runtime_metrics.prom)
 *   VERIFY_APP_RUNTIME_HISTORY — JSONL path (default bench_logs/app_runtime_history.jsonl)
 *   CRITICAL_PATH_REGRESSION_THRESHOLD — multiply baseline p95 (default 1.5)
 *   CRITICAL_PATH_REGRESSION_MIN_RUNS — min history samples with critical_path_ms (default 3)
 *   APP_RUNTIME_CRITICAL_PATH_REGRESSION_ALLOW — set to 1 to exit 0 even when regression detected
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const promPath =
  process.env.VERIFY_APP_RUNTIME_PROM_OUT || join(repoRoot, "bench_logs", "app_runtime_metrics.prom");
const historyPath =
  process.env.VERIFY_APP_RUNTIME_HISTORY || join(repoRoot, "bench_logs", "app_runtime_history.jsonl");
const reportPath = join(repoRoot, "bench_logs", "app_runtime_critical_path_regression_report.json");

const THRESHOLD = Number.parseFloat(process.env.CRITICAL_PATH_REGRESSION_THRESHOLD || "1.5", 10);
const MIN_RUNS = Number.parseInt(process.env.CRITICAL_PATH_REGRESSION_MIN_RUNS || "3", 10);

function parseCriticalPathFromProm(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^app_runtime_critical_path_ms(?:\{[^}]*\})?\s+(\d+(?:\.\d+)?)\s*$/);
    if (m) return Number.parseFloat(m[1], 10);
  }
  return null;
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function loadHistoryCriticalPaths(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.ok !== true) continue;
    let v = j?.dag_analysis?.critical_path_ms;
    if (v == null && typeof j.critical_path_ms === "number") v = j.critical_path_ms;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

function main() {
  mkdirSync(join(repoRoot, "bench_logs"), { recursive: true });

  let current = null;
  if (existsSync(promPath)) {
    try {
      current = parseCriticalPathFromProm(readFileSync(promPath, "utf8"));
    } catch {
      current = null;
    }
  }

  const historyVals = loadHistoryCriticalPaths(historyPath).sort((a, b) => a - b);
  const baselineP95 = percentile(historyVals, 95);

  if (current == null || !Number.isFinite(current)) {
    const result = {
      ok: true,
      skipped: "no_current_critical_path_metric",
      promPath,
      historyPath,
      history_samples: historyVals.length,
    };
    writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (historyVals.length < MIN_RUNS) {
    const result = {
      ok: true,
      skipped: "not_enough_history",
      need_runs: MIN_RUNS,
      have_runs: historyVals.length,
      current_ms: current,
      promPath,
      historyPath,
    };
    writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const regressed = Number.isFinite(baselineP95) && baselineP95 > 0 && current > baselineP95 * THRESHOLD;
  const result = {
    ok: !regressed,
    current_ms: current,
    baseline_p95_ms: baselineP95,
    threshold: THRESHOLD,
    ratio_vs_p95: Number.isFinite(baselineP95) && baselineP95 > 0 ? Number((current / baselineP95).toFixed(3)) : null,
    history_samples: historyVals.length,
    promPath,
    historyPath,
  };

  writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));

  if (regressed && process.env.APP_RUNTIME_CRITICAL_PATH_REGRESSION_ALLOW !== "1") {
    console.error(
      `detect-critical-path-regression: current ${current}ms > p95×${THRESHOLD} (${baselineP95}ms) — see ${reportPath} (set APP_RUNTIME_CRITICAL_PATH_REGRESSION_ALLOW=1 to allow)`,
    );
    process.exit(1);
  }
}

main();
