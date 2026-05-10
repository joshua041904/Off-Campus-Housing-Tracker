#!/usr/bin/env node
/**
 * Suggest a bootstrap DAG linear order using historical phase durations.
 * Among nodes with indegree 0 (Kahn), pick heavier average-duration first so slow
 * phases start as early as dependencies allow (critical-path bias).
 *
 * Defaults:
 *   --graph infra/bootstrap_invariants.graph.json
 *   --timings-dir bench_logs/historical_timings
 *   --out bench_logs/bootstrap_optimized_order.json
 *
 * With no history files, writes baseline topological order (same tie-break as derive-bootstrap-order).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { topologicalOrderBaseline } from "./lib/bootstrap-graph-order.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function loadGraph(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Kahn with ready-set ordered by descending weight, then id */
function topologicalOrderWeighted(graph, weights) {
  const nodes = Object.keys(graph.nodes || {});
  const edges = graph.edges || [];
  const adj = new Map();
  const indeg = new Map();
  for (const n of nodes) {
    adj.set(n, []);
    indeg.set(n, 0);
  }
  for (const [u, v] of edges) {
    if (!adj.has(u) || !indeg.has(v)) throw new Error(`edge references unknown node: ${u} -> ${v}`);
    adj.get(u).push(v);
    indeg.set(v, indeg.get(v) + 1);
  }
  const placed = new Set();
  const out = [];
  const w = (n) => (typeof weights[n] === "number" && Number.isFinite(weights[n]) ? weights[n] : 0);
  while (placed.size < nodes.length) {
    const ready = nodes.filter((n) => !placed.has(n) && indeg.get(n) === 0);
    if (!ready.length) throw new Error("graph has a cycle (weighted topological sort incomplete)");
    ready.sort((a, b) => {
      const d = w(b) - w(a);
      if (d !== 0) return d;
      return a.localeCompare(b);
    });
    const u = ready[0];
    placed.add(u);
    out.push(u);
    for (const v of adj.get(u) || []) {
      indeg.set(v, indeg.get(v) - 1);
    }
  }
  return out;
}

function loadTimingSnapshots(dir) {
  if (!existsSync(dir)) return [];
  const runs = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const p = join(dir, name);
    let obj;
    try {
      obj = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    const ok = Object.entries(obj).every(
      ([k, v]) => typeof k === "string" && (typeof v === "number" || typeof v === "string")
    );
    if (!ok) continue;
    runs.push(obj);
  }
  return runs;
}

function averageTimings(runs) {
  const map = new Map();
  for (const run of runs) {
    for (const [phase, raw] of Object.entries(run)) {
      const t = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(t)) continue;
      if (!map.has(phase)) map.set(phase, []);
      map.get(phase).push(t);
    }
  }
  const avg = {};
  for (const [phase, values] of map) {
    avg[phase] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return avg;
}

function main() {
  let graphPath = join(repoRoot, "infra/bootstrap_invariants.graph.json");
  let timingsDir = join(repoRoot, "bench_logs/historical_timings");
  let outPath = join(repoRoot, "bench_logs/bootstrap_optimized_order.json");
  let printJson = false;
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--graph" && argv[i + 1]) graphPath = argv[++i];
    else if (argv[i] === "--timings-dir" && argv[i + 1]) timingsDir = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) outPath = argv[++i];
    else if (argv[i] === "--json") printJson = true;
  }

  const graph = loadGraph(graphPath);
  const baseline = topologicalOrderBaseline(graph);
  const runs = loadTimingSnapshots(timingsDir);
  const avg = runs.length ? averageTimings(runs) : {};
  const optimized = runs.length ? topologicalOrderWeighted(graph, avg) : baseline;

  const payload = {
    version: graph.version || "v1.1",
    baseline_order: baseline,
    optimized,
    avg_timings: avg,
    based_on_runs: runs.length,
    graphPath,
    timingsDir,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  if (printJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(outPath);
  }
}

main();
