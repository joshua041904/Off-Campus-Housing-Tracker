#!/usr/bin/env node
/**
 * Slowest service from trace + optional git diff overlap (CI annotation).
 * Usage: node scripts/trace-blame-ci.mjs trace.json [--base origin/main]
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTrace } from "./trace-validators/lib/jaeger-traces.mjs";
import { computeServiceContribution } from "./lib/trace-analysis.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

function getArg(argv, name, def) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  return argv[i + 1];
}

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("-"));
if (!file) {
  console.error("Usage: node scripts/trace-blame-ci.mjs <trace.json> [--base origin/main]");
  process.exit(1);
}
const base = getArg(argv, "--base", process.env.GITHUB_BASE_REF || "origin/main");

const j = JSON.parse(readFileSync(file, "utf8"));
const trace = Array.isArray(j.data) && j.data[0] ? normalizeTrace(j.data[0]) : normalizeTrace(j);
const { sorted } = computeServiceContribution(trace);
const slowest = sorted[0]?.[0] || "unknown";
const slowMs = sorted[0]?.[1] ?? 0;

const mapPath = join(REPO, "infra/service_map.json");
const map = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, "utf8")) : {};
const svcPath = map[slowest] || "";

let touched = false;
try {
  const diff = execSync(`git -C "${REPO}" diff --name-only ${base}...HEAD`, { encoding: "utf8" });
  const files = diff.split("\n").filter(Boolean);
  touched = svcPath ? files.some((f) => f.startsWith(svcPath)) : false;
} catch {
  touched = false;
}

const out = {
  slowest_service: slowest,
  slowest_service_ms: Math.round(slowMs * 10) / 10,
  repo_path: svcPath || null,
  touched_in_diff: touched,
  base,
};
console.log(JSON.stringify(out, null, 2));

if (process.env.GITHUB_ACTIONS === "true") {
  console.log(
    `::notice title=Trace contribution::slowest=${slowest} ${slowMs.toFixed(1)}ms touched_in_pr=${touched ? "yes" : "no"}`,
  );
}
