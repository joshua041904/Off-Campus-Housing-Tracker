#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const inPath = process.argv[2] || "bench_logs/trace_coverage.json";
const outPath = process.argv[3] || "bench_logs/trace_coverage.prom";
const data = JSON.parse(readFileSync(inPath, "utf8"));
const lines = [
  "# HELP trace_coverage_ratio Fraction of expected housing services present in trace",
  "# TYPE trace_coverage_ratio gauge",
  `trace_coverage_ratio ${data.coverage}`,
  "# HELP trace_services_seen Distinct services in trace",
  "# TYPE trace_services_seen gauge",
  `trace_services_seen ${data.services_seen?.length ?? 0}`,
  "# HELP trace_services_total Expected housing services (discovery)",
  "# TYPE trace_services_total gauge",
  `trace_services_total ${data.total_services ?? 0}`,
  "",
];
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"));
console.log(`✅ wrote ${outPath}`);
