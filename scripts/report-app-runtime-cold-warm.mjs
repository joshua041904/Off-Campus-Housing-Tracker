#!/usr/bin/env node
/**
 * Latest cold vs warm app-runtime history (bench_logs/app_runtime_history.jsonl).
 * Env: VERIFY_APP_RUNTIME_HISTORY — override JSONL path.
 * Usage: node scripts/report-app-runtime-cold-warm.mjs [--json-out path]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const histPath = process.env.VERIFY_APP_RUNTIME_HISTORY || join(root, "bench_logs", "app_runtime_history.jsonl");

let jsonOut = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--json-out" && argv[i + 1]) {
    jsonOut = argv[++i];
  }
}

if (!existsSync(histPath)) {
  console.error(`report-app-runtime-cold-warm: missing history file: ${histPath}`);
  process.exit(2);
}

const lines = readFileSync(histPath, "utf8").trim().split("\n").filter(Boolean);
/** @type {any[]} */
const rows = [];
for (const ln of lines) {
  try {
    rows.push(JSON.parse(ln));
  } catch {
    /* skip corrupt line */
  }
}

function latest(phase) {
  let best = null;
  for (const r of rows) {
    if (r?.verify_app_runtime_phase !== phase) continue;
    if (r?.ok !== true) continue;
    if (!best || (r.unix_ms ?? 0) > (best.unix_ms ?? 0)) best = r;
  }
  return best;
}

const cold = latest("cold");
const warm = latest("warm");

const report = {
  history_file: histPath,
  cold_unix_ms: cold?.unix_ms ?? null,
  warm_unix_ms: warm?.unix_ms ?? null,
  namespace_cold: cold?.namespace ?? null,
  namespace_warm: warm?.namespace ?? null,
  deltas: [],
  percentiles_delta_ms: null,
};

if (!cold || !warm) {
  const msg = !cold && !warm
    ? "No successful cold/warm tagged rows yet. Run cold-bootstrap (tags cold) then VERIFY_APP_RUNTIME_PHASE=warm make verify-app-runtime."
    : !cold
      ? "No successful cold-tagged row; run make cold-bootstrap (or VERIFY_APP_RUNTIME_PHASE=cold with a successful verify)."
      : "No successful warm-tagged row; run VERIFY_APP_RUNTIME_PHASE=warm make verify-app-runtime after a cold baseline.";
  console.log(msg);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...report, note: msg }, null, 2) + "\n", "utf8");
  process.exit(0);
}

if (cold.namespace && warm.namespace && cold.namespace !== warm.namespace) {
  console.warn(
    `report-app-runtime-cold-warm: namespace mismatch cold=${cold.namespace} warm=${warm.namespace} (comparing anyway)`,
  );
}

const byName = (svc) => Object.fromEntries((svc || []).map((s) => [s.name, s]));

const cMap = byName(cold.services);
const wMap = byName(warm.services);
const names = new Set([...Object.keys(cMap), ...Object.keys(wMap)]);

for (const name of [...names].sort()) {
  const a = cMap[name];
  const b = wMap[name];
  const coldMs = a?.latency_ms ?? null;
  const warmMs = b?.latency_ms ?? null;
  let delta = null;
  if (coldMs != null && warmMs != null) delta = warmMs - coldMs;
  report.deltas.push({ name, cold_ms: coldMs, warm_ms: warmMs, delta_ms: delta });
}

const cp = cold.percentiles_ms || {};
const wp = warm.percentiles_ms || {};
report.percentiles_delta_ms = {
  p50: (wp.p50 ?? null) != null && (cp.p50 ?? null) != null ? wp.p50 - cp.p50 : null,
  p95: (wp.p95 ?? null) != null && (cp.p95 ?? null) != null ? wp.p95 - cp.p95 : null,
  p99: (wp.p99 ?? null) != null && (cp.p99 ?? null) != null ? wp.p99 - cp.p99 : null,
  p100: (wp.p100 ?? null) != null && (cp.p100 ?? null) != null ? wp.p100 - cp.p100 : null,
};

console.log("=== App runtime: latest cold vs warm (successful rows) ===");
console.log(`Cold unix_ms=${cold.unix_ms} namespace=${cold.namespace}`);
console.log(`Warm unix_ms=${warm.unix_ms} namespace=${warm.namespace}`);
console.log("");
console.log("Per-service latency (ms):");
for (const d of report.deltas) {
  const extra = d.delta_ms == null ? "" : `  Δ warm−cold = ${d.delta_ms >= 0 ? "+" : ""}${d.delta_ms} ms`;
  console.log(`  ${d.name}: cold=${d.cold_ms ?? "—"} warm=${d.warm_ms ?? "—"}${extra}`);
}
console.log("");
console.log("Percentiles warm − cold (ms):", JSON.stringify(report.percentiles_delta_ms));

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${jsonOut}`);
}
