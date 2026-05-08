#!/usr/bin/env node
/**
 * Per-edge latency aggregation (child span duration as hop cost proxy).
 * Usage: node scripts/generate-trace-weighted-graph.mjs <trace.json> [--json-out bench_logs/trace_weighted_graph.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeTrace } from "./trace-validators/lib/jaeger-traces.mjs";
import { buildWeightedCallGraph } from "./lib/trace-graph-build.mjs";

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  return argv[i + 1];
}

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("-"));
if (!file) {
  console.error("Usage: node scripts/generate-trace-weighted-graph.mjs <trace.json> [--json-out PATH]");
  process.exit(1);
}
const out = getArg(argv, "--json-out", "bench_logs/trace_weighted_graph.json");

const j = JSON.parse(readFileSync(file, "utf8"));
const trace = Array.isArray(j.data) && j.data[0] ? normalizeTrace(j.data[0]) : normalizeTrace(j);
const graph = buildWeightedCallGraph(trace);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(graph, null, 2)}\n`);
console.log(`🔥 weighted graph written: ${out} (${graph.length} edges)`);
