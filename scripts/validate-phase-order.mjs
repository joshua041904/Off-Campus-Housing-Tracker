#!/usr/bin/env node
/**
 * Enforce linear bootstrap phase order vs bench_logs/bootstrap_state_progress.json.
 * Next runnable phase = first entry in the active order not listed in completed[].
 * --phase may be already complete (idempotent no-op). Otherwise it must equal that next phase.
 *
 * CLI:
 *   node scripts/validate-phase-order.mjs --phase NODE [--order-file PATH] [--graph PATH] [--progress PATH]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { topologicalOrderBaseline } from "./lib/bootstrap-graph-order.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function loadOrder(orderFile, graphPath) {
  try {
    if (existsSync(orderFile)) {
      const j = JSON.parse(readFileSync(orderFile, "utf8"));
      if (Array.isArray(j.optimized) && j.optimized.length) return j.optimized;
    }
  } catch {
    /* fall through */
  }
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  return topologicalOrderBaseline(graph);
}

function parseArgs(argv) {
  let phase = "";
  let orderFile = join(repoRoot, "bench_logs/bootstrap_optimized_order.json");
  let graphPath = join(repoRoot, "infra/bootstrap_invariants.graph.json");
  let progressPath = join(repoRoot, "bench_logs/bootstrap_state_progress.json");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--phase" && argv[i + 1]) phase = argv[++i];
    else if (a === "--order-file" && argv[i + 1]) orderFile = argv[++i];
    else if (a === "--graph" && argv[i + 1]) graphPath = argv[++i];
    else if (a === "--progress" && argv[i + 1]) progressPath = argv[++i];
  }
  return { phase, orderFile, graphPath, progressPath };
}

function main() {
  const { phase, orderFile, graphPath, progressPath } = parseArgs(process.argv);
  if (!phase) {
    console.error("validate-phase-order: missing --phase NODE");
    process.exit(2);
  }

  const order = loadOrder(orderFile, graphPath);
  if (!order.includes(phase)) {
    console.error(`validate-phase-order: phase "${phase}" is not in the active order list`);
    process.exit(2);
  }
  let progress = { completed: [] };
  try {
    progress = JSON.parse(readFileSync(progressPath, "utf8"));
  } catch {
    progress = { completed: [] };
  }
  const completed = new Set(Array.isArray(progress.completed) ? progress.completed : []);

  if (completed.has(phase)) {
    console.log(`validate-phase-order: ${phase} already complete — ok (idempotent)`);
    process.exit(0);
  }

  const next = order.find((n) => !completed.has(n));
  if (!next) {
    console.error("validate-phase-order: all phases already complete but --phase not in completed[]");
    process.exit(1);
  }
  if (next !== phase) {
    console.error(
      `validate-phase-order: expected next phase "${next}" (linear order), got "${phase}" (order-file=${orderFile})`
    );
    process.exit(1);
  }
  console.log(`validate-phase-order: ${phase} is next in order — ok`);
}

main();
