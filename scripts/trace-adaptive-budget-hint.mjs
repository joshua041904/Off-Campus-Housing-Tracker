#!/usr/bin/env node
/**
 * Read bench_logs/trace_history.jsonl (lines of JSON with criticalPathMs + endpoint) and print
 * suggested p95 * 1.2 budget hints (does not write files unless --write-budgets).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const hist = join(REPO, "bench_logs/trace_history.jsonl");

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const argv = process.argv.slice(2);
const writeOut = argv.includes("--write-budgets");
if (!existsSync(hist)) {
  console.log(JSON.stringify({ hint: "no_history", path: hist }, null, 2));
  process.exit(0);
}

const byEp = {};
for (const line of readFileSync(hist, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    const ep = row.endpoint || "*";
    const ms = Number(row.criticalPathMs);
    if (!Number.isFinite(ms)) continue;
    if (!byEp[ep]) byEp[ep] = [];
    byEp[ep].push(ms);
  } catch {
    /* skip */
  }
}

const budgets = {};
for (const [ep, arr] of Object.entries(byEp)) {
  const s = [...arr].sort((a, b) => a - b);
  const p95 = percentile(s, 95);
  budgets[ep] = Math.ceil(p95 * 1.2 + 50);
}

console.log(JSON.stringify({ source: hist, suggestedBudgetsMs: budgets }, null, 2));
if (writeOut) {
  const defPath = join(REPO, "infra/trace_latency_budgets.suggested.json");
  writeFileSync(defPath, `${JSON.stringify(budgets, null, 2)}\n`);
  console.log("wrote", defPath);
}
