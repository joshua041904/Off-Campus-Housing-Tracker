#!/usr/bin/env node
/**
 * Flatten trace spans into stacked "layer" rows for visualization (SVG/flamegraph tools consume externally).
 * Usage: node scripts/compute-trace-flamegraph-layers.mjs trace.json [--json-out bench_logs/trace_flame_layers.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeTrace, serviceName } from "./trace-validators/lib/jaeger-traces.mjs";
import { jaegerDurationToMs } from "./lib/trace-analysis.mjs";
import { childOfParentSpanId } from "./trace-validators/lib/span-parent-ref.mjs";

function parentRef(span) {
  return childOfParentSpanId(span);
}

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  return argv[i + 1];
}

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("-"));
if (!file) {
  console.error("Usage: node scripts/compute-trace-flamegraph-layers.mjs <trace.json> [--json-out PATH]");
  process.exit(1);
}
const out = getArg(argv, "--json-out", "");

const j = JSON.parse(readFileSync(file, "utf8"));
const trace = Array.isArray(j.data) && j.data[0] ? normalizeTrace(j.data[0]) : normalizeTrace(j);
const spans = trace?.spans || [];
const processes = trace?.processes || {};

const layers = spans.map((s) => ({
  spanID: String(s.spanID),
  parentSpanID: parentRef(s),
  service: serviceName(s, processes),
  operationName: s.operationName || "",
  startTime: s.startTime,
  durationMs: jaegerDurationToMs(s.duration),
}));

const payload = { traceID: trace.traceID, layers };
console.log(JSON.stringify(payload, null, 2));
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
}
