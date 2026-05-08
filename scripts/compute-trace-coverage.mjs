#!/usr/bin/env node
/**
 * trace coverage = distinct Jaeger services in trace / expected housing services (repo discovery).
 * Usage: node scripts/compute-trace-coverage.mjs <trace.json> [--json-out bench_logs/trace_coverage.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTrace, serviceName } from "./trace-validators/lib/jaeger-traces.mjs";
import { discoverJaegerHousingServices } from "./trace-validators/lib/housing-services.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  return argv[i + 1];
}

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("-"));
if (!file) {
  console.error("Usage: node scripts/compute-trace-coverage.mjs <trace.json> [--json-out PATH]");
  process.exit(1);
}
const out = getArg(argv, "--json-out", "bench_logs/trace_coverage.json");

const j = JSON.parse(readFileSync(file, "utf8"));
const trace = Array.isArray(j.data) && j.data[0] ? normalizeTrace(j.data[0]) : normalizeTrace(j);
const spans = trace?.spans || [];
const processes = trace?.processes || {};
const inTrace = new Set(spans.map((s) => serviceName(s, processes)).filter(Boolean));
const all = discoverJaegerHousingServices(root);
const coverage = all.length ? inTrace.size / all.length : 0;
const missing = all.filter((s) => !inTrace.has(s));

const payload = {
  coverage,
  services_seen: [...inTrace].sort(),
  total_services: all.length,
  expected_services: all,
  missing_services: missing,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`📊 coverage: ${(coverage * 100).toFixed(1)}% (${inTrace.size}/${all.length})`);

const minCov = Number(process.env.TRACE_COVERAGE_MIN || "0");
if (minCov > 0 && coverage < minCov) {
  console.error(`❌ coverage too low: ${coverage} < ${minCov}`);
  process.exit(1);
}
