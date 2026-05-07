#!/usr/bin/env node
/** DOT from bench_logs/trace_call_graph.json */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const inPath = process.argv[2] || "bench_logs/trace_call_graph.json";
const outPath = process.argv[3] || "bench_logs/trace_call_graph.dot";
const graph = JSON.parse(readFileSync(inPath, "utf8"));
let dot = "digraph G {\n  rankdir=LR;\n";
for (const e of graph) {
  dot += `  "${e.from}" -> "${e.to}";\n`;
}
dot += "}\n";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, dot);
console.log(`✅ wrote ${outPath}`);
