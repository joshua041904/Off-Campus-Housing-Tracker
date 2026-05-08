#!/usr/bin/env node
/**
 * Self-contained HTML for bootstrap DAG + progress (open file:// safely — data embedded).
 * Usage: node scripts/render-bootstrap-dag-html.mjs [--html-out bench_logs/bootstrap_dag.html]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const graphPath = join(repoRoot, "infra/bootstrap_invariants.graph.json");
const progressPath = join(repoRoot, "bench_logs/bootstrap_state_progress.json");
const timingsPath = join(repoRoot, "bench_logs/bootstrap_phase_timings.json");

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
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
    if (!adj.has(u) || !indeg.has(v)) throw new Error(`unknown edge ${u} -> ${v}`);
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
  if (out.length !== nodes.length) throw new Error("cycle in graph");
  return out;
}

function main() {
  let htmlOut = join(repoRoot, "bench_logs", "bootstrap_dag.html");
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--html-out" && argv[i + 1]) htmlOut = argv[++i];
  }
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  const order = topologicalOrder(graph);
  const progress = loadJson(progressPath, { completed: [], failed: [] });
  const completed = Array.isArray(progress.completed) ? progress.completed : [];
  const failed = Array.isArray(progress.failed) ? progress.failed : [];
  const timings = loadJson(timingsPath, {});

  const payload = {
    version: graph.version || "v1.1",
    allowed_order: order,
    completed,
    failed,
    timings,
    edges: graph.edges || [],
  };
  const embedded = JSON.stringify(payload).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Bootstrap DAG — progress</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #111; color: #eee; }
    h1 { font-size: 1.25rem; }
    .meta { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
    .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: stretch; }
    .node { padding: 0.5rem 0.75rem; border-radius: 8px; min-width: 8rem; border: 1px solid #333; }
    .done { background: #1b5e20; border-color: #4caf50; }
    .pending { background: #2a2a2a; color: #bbb; }
    .failed { background: #b71c1c; border-color: #ff5252; }
    .edge { font-size: 0.75rem; color: #666; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>Bootstrap invariant DAG</h1>
  <p class="meta">Green = completed · Red = failed (message + log path) · Gray = pending. Timings from bootstrap_phase_timings.json (ms). Re-run render after bootstrap.</p>
  <div class="row" id="nodes"></div>
  <div class="edge" id="edges"></div>
  <script type="application/json" id="bootstrap-dag-data">${embedded}</script>
  <script>
    const raw = document.getElementById("bootstrap-dag-data").textContent;
    const data = JSON.parse(raw);
    const done = new Set(data.completed || []);
    const failedBy = new Map((data.failed || []).map((f) => [f.node, f]));
    const timings = data.timings || {};
    const el = document.getElementById("nodes");
    const fmtMs = (id) => {
      const v = timings[id];
      return v != null && v !== "" ? " (" + v + " ms)" : "";
    };
    const logHint = (f) => {
      if (!f || !f.logFile) return "";
      const s = String(f.logFile);
      const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\\\"));
      const bn = i >= 0 ? s.slice(i + 1) : s;
      return "\\nlog: " + bn;
    };
    for (const id of data.allowed_order || []) {
      const div = document.createElement("div");
      div.className = "node";
      const f = failedBy.get(id);
      if (f) {
        div.classList.add("failed");
        div.textContent = id + fmtMs(id) + "\\n" + (f.message || "failed").slice(0, 120) + logHint(f);
      } else if (done.has(id)) {
        div.classList.add("done");
        div.textContent = id + fmtMs(id);
      } else {
        div.classList.add("pending");
        div.textContent = id + fmtMs(id);
      }
      el.appendChild(div);
    }
    const ee = document.getElementById("edges");
    ee.textContent = (data.edges || []).map(([a, b]) => a + " → " + b).join(" · ");
  </script>
</body>
</html>
`;

  mkdirSync(dirname(htmlOut), { recursive: true });
  writeFileSync(htmlOut, html, "utf8");
  console.log(htmlOut);
}

main();
