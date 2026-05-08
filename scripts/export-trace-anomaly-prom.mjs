#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inPath = process.argv[2] || join(root, "bench_logs/trace_anomalies.json");
const outPath = process.argv[3] || join(root, "bench_logs/trace_anomaly.prom");
if (!existsSync(inPath)) {
  console.error("missing", inPath);
  process.exit(0);
}
const anomalies = JSON.parse(readFileSync(inPath, "utf8"));
const lines = ["# TYPE trace_edge_anomaly gauge"];
for (const a of anomalies) {
  const edge = String(a.edge).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  lines.push(`trace_edge_anomaly{edge="${edge}"} ${a.ratio}`);
}
lines.push("");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"));
console.log("✅", outPath);
