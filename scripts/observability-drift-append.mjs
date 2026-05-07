#!/usr/bin/env node
/**
 * Append one JSON line to bench_logs/observability-history.jsonl for drift tracking.
 * Reads step7-observability-gates.json from --report-dir or PREFLIGHT_RUN_DIR/step7-observability.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const repo = process.cwd();
const reportDir =
  process.argv.includes("--report-dir") ?
    process.argv[process.argv.indexOf("--report-dir") + 1]
  : join(process.env.PREFLIGHT_RUN_DIR || join(repo, "bench_logs"), "step7-observability");

const gatePath = join(reportDir, "step7-observability-gates.json");
if (!existsSync(gatePath)) {
  console.error("No step7-observability-gates.json — run observability gates first");
  process.exit(0);
}
const row = JSON.parse(readFileSync(gatePath, "utf8"));
const line = JSON.stringify({
  t: new Date().toISOString(),
  status: row.status,
  traceID: row.traceID || null,
  spanCount: row.spanTree?.spanCount ?? null,
  depth: row.spanTree?.depth ?? null,
}) + "\n";

const hist = join(repo, "bench_logs", "observability-history.jsonl");
mkdirSync(join(repo, "bench_logs"), { recursive: true });
appendFileSync(hist, line);
console.log(`appended → ${hist}`);
