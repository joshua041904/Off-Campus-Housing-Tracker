#!/usr/bin/env node
/**
 * Print critical path + service contribution for a Jaeger trace JSON file.
 * Usage: node scripts/compute-trace-critical-path.mjs path/to/trace.json [--json-out bench_logs/trace_critical_path.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeTrace } from "./trace-validators/lib/jaeger-traces.mjs";
import {
  computeCriticalPath,
  computeServiceContribution,
  extractRootHttpRoute,
} from "./lib/trace-analysis.mjs";

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  return argv[i + 1];
}

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("-"));
if (!file) {
  console.error("Usage: node scripts/compute-trace-critical-path.mjs <trace.json> [--json-out PATH]");
  process.exit(1);
}
const out = getArg(argv, "--json-out", "");

const j = JSON.parse(readFileSync(file, "utf8"));
const trace = Array.isArray(j.data) && j.data[0] ? normalizeTrace(j.data[0]) : normalizeTrace(j);
if (!trace?.spans?.length) {
  console.error("Invalid trace");
  process.exit(1);
}

const cp = computeCriticalPath(trace);
const contrib = computeServiceContribution(trace);
const endpoint = extractRootHttpRoute(trace);
const payload = {
  endpoint,
  criticalPathMs: cp.criticalPathMs,
  path: cp.path,
  serviceContribution: contrib.byService,
  serviceContributionSorted: contrib.sorted,
};

console.log(JSON.stringify(payload, null, 2));

if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
}
