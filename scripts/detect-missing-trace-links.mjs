#!/usr/bin/env node
/**
 * Compare expected gateway→service fanout (from repo discovery) vs actual trace_call_graph.json.
 * Usage: node scripts/detect-missing-trace-links.mjs [trace_call_graph.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverJaegerHousingServices } from "./trace-validators/lib/housing-services.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const graphPath = process.argv[2] || join(root, "bench_logs/trace_call_graph.json");
const outPath = join(root, "bench_logs/trace_missing_edges.json");

const actual = JSON.parse(readFileSync(graphPath, "utf8"));
const actualSet = new Set(actual.map((e) => `${e.from}->${e.to}`));

const all = discoverJaegerHousingServices(root);
const targets = all.filter((s) => s !== "api-gateway");
const missing = [];
for (const to of targets) {
  const key = `api-gateway->${to}`;
  if (!actualSet.has(key)) {
    missing.push({ from: "api-gateway", to, hint: `api-gateway should reach ${to} (e.g. /api/debug/full-trace hop)` });
  }
}

writeFileSync(outPath, `${JSON.stringify(missing, null, 2)}\n`);
if (missing.length) {
  console.error("❌ missing edges detected:");
  for (const m of missing) console.error(`  💡 ${m.from} → ${m.to}`);
  process.exit(1);
}
console.log("✅ no missing gateway fanout edges");
