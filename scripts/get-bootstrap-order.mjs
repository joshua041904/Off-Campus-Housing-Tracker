#!/usr/bin/env node
/**
 * Print a single line: space-separated DAG node order for Make $(shell …).
 * Uses BOOTSTRAP_ORDER_FILE (default bench_logs/bootstrap_optimized_order.json) when it exists
 * and contains a non-empty "optimized" array; otherwise baseline topo from the graph.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { topologicalOrderBaseline } from "./lib/bootstrap-graph-order.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const graphPath = process.env.BOOTSTRAP_GRAPH || join(repoRoot, "infra/bootstrap_invariants.graph.json");
const orderFile =
  process.env.BOOTSTRAP_ORDER_FILE || join(repoRoot, "bench_logs/bootstrap_optimized_order.json");

function baselineFromDisk() {
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  return topologicalOrderBaseline(graph);
}

const FALLBACK_ORDER =
  "A.workspace B.crypto C.infra C.metrics C.images G.app_runtime D.observability F.kafka_alignment E.transport";

function main() {
  try {
    if (existsSync(orderFile)) {
      const j = JSON.parse(readFileSync(orderFile, "utf8"));
      if (Array.isArray(j.optimized) && j.optimized.length) {
        console.log(j.optimized.join(" "));
        return;
      }
    }
  } catch {
    /* fall through */
  }
  try {
    console.log(baselineFromDisk().join(" "));
  } catch {
    console.log(FALLBACK_ORDER);
  }
}

main();
