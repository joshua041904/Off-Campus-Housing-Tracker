#!/usr/bin/env node
/**
 * Fail if weighted edge avg_ms exceeds infra/trace_edge_latency_baseline.json * TRACE_EDGE_THRESHOLD.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const graphPath = process.argv[2] || join(root, "bench_logs/trace_weighted_graph.json");
const baselinePath = process.env.TRACE_EDGE_BASELINE_FILE || join(root, "infra/trace_edge_latency_baseline.json");
const threshold = Number(process.env.TRACE_EDGE_THRESHOLD || "1.5");

if (!existsSync(graphPath) || !existsSync(baselinePath)) {
  console.error("missing graph or baseline");
  process.exit(1);
}
const graph = JSON.parse(readFileSync(graphPath, "utf8"));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const violations = [];
for (const e of graph) {
  const key = `${e.from}->${e.to}`;
  const expected = baseline[key];
  if (expected == null) continue;
  if (e.avg_ms > expected * threshold) {
    violations.push({ edge: key, current: e.avg_ms, expected, ratio: e.avg_ms / expected });
  }
}
if (violations.length) {
  console.error("❌ latency baseline violated");
  console.error(violations);
  process.exit(1);
}
console.log("✅ edge latency within baseline");
