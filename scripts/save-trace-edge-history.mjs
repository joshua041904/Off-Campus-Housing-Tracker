#!/usr/bin/env node
/** Append weighted graph run to bench_logs/trace_edge_history.jsonl */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] || join(root, "bench_logs/trace_weighted_graph.json");
const hist = join(root, "bench_logs/trace_edge_history.jsonl");
if (!existsSync(src)) {
  console.error("missing", src);
  process.exit(1);
}
const graph = JSON.parse(readFileSync(src, "utf8"));
const entry = { ts: new Date().toISOString(), edges: graph };
mkdirSync(dirname(hist), { recursive: true });
appendFileSync(hist, `${JSON.stringify(entry)}\n`);
console.log("✅ appended to", hist);
