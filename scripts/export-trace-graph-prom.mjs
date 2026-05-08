#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = process.argv[2] || join(root, "bench_logs/trace_weighted_graph.json");
const outPath = process.argv[3] || join(root, "bench_logs/trace_graph.prom");
const graph = JSON.parse(readFileSync(inPath, "utf8"));
const lines = ["# TYPE trace_edge_latency_ms gauge"];
for (const e of graph) {
  const from = String(e.from).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const to = String(e.to).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  lines.push(`trace_edge_latency_ms{from="${from}",to="${to}"} ${e.avg_ms}`);
}
lines.push("");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"));
console.log("✅", outPath);
