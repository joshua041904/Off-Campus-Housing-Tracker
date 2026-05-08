#!/usr/bin/env node
/**
 * Topological sort of infra/bootstrap_invariants.graph.json (Kahn).
 * Emits { allowed_order, acyclic, timingMs, version } to stdout or --json-out.
 *
 * CLI:
 *   node scripts/derive-bootstrap-order.mjs [--json-out PATH] [--write-dot PATH]
 *   node scripts/derive-bootstrap-order.mjs --at-risk-from NODE   (reverse reachability for drift)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const defaultGraph = join(repoRoot, "infra/bootstrap_invariants.graph.json");

function loadGraph(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function topologicalOrder(graph) {
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
  const q = [];
  for (const [n, d] of indeg) {
    if (d === 0) q.push(n);
  }
  q.sort();
  const out = [];
  while (q.length) {
    const u = q.shift();
    out.push(u);
    for (const v of adj.get(u) || []) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) {
        q.push(v);
        q.sort();
      }
    }
  }
  if (out.length !== nodes.length) {
    throw new Error("graph has a cycle (topological sort incomplete)");
  }
  return out;
}

function reverseReachable(graph, fromNode) {
  const edges = graph.edges || [];
  const rev = new Map();
  for (const [u, v] of edges) {
    if (!rev.has(v)) rev.set(v, []);
    rev.get(v).push(u);
  }
  const seen = new Set();
  const stack = [fromNode];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const p of rev.get(n) || []) stack.push(p);
  }
  seen.delete(fromNode);
  return [...seen];
}

function toDot(graph, order) {
  const lines = ["digraph bootstrap_invariants {", '  rankdir="LR";', "  node [shape=box];"];
  for (const id of order) {
    const n = graph.nodes[id] || {};
    const label = `${id}\\n${(n.description || "").slice(0, 48)}`;
    const safe = id.replace(/\./g, "_");
    lines.push(`  "${safe}" [label="${label.replace(/"/g, '\\"')}"];`);
  }
  for (const [u, v] of graph.edges || []) {
    lines.push(`  "${u.replace(/\./g, "_")}" -> "${v.replace(/\./g, "_")}";`);
  }
  lines.push("}");
  return lines.join("\n");
}

function parseArgs(argv) {
  let jsonOut = "";
  let writeDot = "";
  let atRiskFrom = "";
  let graphPath = defaultGraph;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json-out" && argv[i + 1]) jsonOut = argv[++i];
    else if (a === "--write-dot" && argv[i + 1]) writeDot = argv[++i];
    else if (a === "--at-risk-from" && argv[i + 1]) atRiskFrom = argv[++i];
    else if (a === "--graph" && argv[i + 1]) graphPath = argv[++i];
    else if (a.startsWith("--graph=")) graphPath = a.slice("--graph=".length);
  }
  return { jsonOut, writeDot, atRiskFrom, graphPath };
}

function main() {
  const argv = process.argv;
  const { jsonOut, writeDot, atRiskFrom, graphPath } = parseArgs(argv);
  const t0 = performance.now();
  const graph = loadGraph(graphPath);

  if (atRiskFrom) {
    if (!graph.nodes[atRiskFrom]) {
      console.error(`Unknown node: ${atRiskFrom}`);
      process.exit(1);
    }
    const atRisk = reverseReachable(graph, atRiskFrom);
    const doc = { at_risk_upstream_of: atRiskFrom, nodes: atRisk, graph_version: graph.version };
    console.log(JSON.stringify(doc, null, 2));
    process.exit(0);
  }

  const allowed_order = topologicalOrder(graph);
  const timingMs = Math.round(performance.now() - t0);
  const payload = {
    version: graph.version || "v1.0",
    acyclic: true,
    allowed_order,
    timingMs,
    graph_path: graphPath,
  };
  const text = JSON.stringify(payload, null, 2);
  console.log(text);
  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, text, "utf8");
  }
  if (writeDot) {
    const dot = toDot(graph, allowed_order);
    mkdirSync(dirname(writeDot), { recursive: true });
    writeFileSync(writeDot, dot, "utf8");
    console.error(`Wrote DOT: ${writeDot}`);
  }
}

main();
