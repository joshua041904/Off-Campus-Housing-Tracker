#!/usr/bin/env node
/**
 * Compare current trace_weighted_graph.json vs trace_edge_history.jsonl (p95 * ratio).
 * Env: TRACE_ANOMALY_RATIO (default 1.5), TRACE_ANOMALY_MIN_SAMPLES (default 3)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const curPath = process.argv[2] || join(root, "bench_logs/trace_weighted_graph.json");
const histPath = join(root, "bench_logs/trace_edge_history.jsonl");
const outPath = join(root, "bench_logs/trace_anomalies.json");
const ratio = Number(process.env.TRACE_ANOMALY_RATIO || "1.5");
const minSamples = Number(process.env.TRACE_ANOMALY_MIN_SAMPLES || "3");

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

if (!existsSync(histPath)) {
  console.log("⚠️ no history yet —", histPath);
  writeFileSync(outPath, "[]\n");
  process.exit(0);
}

const lines = readFileSync(histPath, "utf8").trim().split("\n").filter(Boolean);
const history = lines.map((l) => JSON.parse(l));
/** @type {Record<string, number[]>} */
const edgeStats = {};
for (const run of history) {
  for (const e of run.edges || []) {
    const key = `${e.from}->${e.to}`;
    if (!edgeStats[key]) edgeStats[key] = [];
    edgeStats[key].push(e.avg_ms);
  }
}

const current = JSON.parse(readFileSync(curPath, "utf8"));
const anomalies = [];
for (const edge of current) {
  const key = `${edge.from}->${edge.to}`;
  const hist = edgeStats[key] || [];
  if (hist.length < minSamples) continue;
  const sorted = [...hist].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  if (p95 > 0 && edge.avg_ms > p95 * ratio) {
    anomalies.push({
      edge: key,
      current: edge.avg_ms,
      baseline_p95: Math.round(p95 * 10) / 10,
      ratio: Math.round((edge.avg_ms / p95) * 100) / 100,
    });
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(anomalies, null, 2)}\n`);
if (anomalies.length) {
  console.error("❌ anomalies detected");
  console.error(anomalies);
  process.exit(1);
}
console.log("✅ no anomalies");
