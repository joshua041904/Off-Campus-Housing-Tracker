#!/usr/bin/env node
/**
 * Execution legality guard for bootstrap invariant DAG (infra/bootstrap_invariants.graph.json).
 *
 * bench_logs/bootstrap_state_progress.json — { completed, failed[], sessionStartedAt, events }
 *
 * CLI:
 *   node scripts/bootstrap-phase-guard.mjs --enter NODE
 *   node scripts/bootstrap-phase-guard.mjs --complete NODE
 *   node scripts/bootstrap-phase-guard.mjs --reset
 *   node scripts/bootstrap-phase-guard.mjs --is-complete NODE   (exit 0 if NODE in completed[], else 1)
 *   node scripts/bootstrap-phase-guard.mjs --fail NODE --message "why" [--log-file PATH]   (record failure + optional log path)
 *   node scripts/bootstrap-phase-guard.mjs --sync-verify-json PATH   (maps verify-bootstrap-state output)
 *   node scripts/bootstrap-phase-guard.mjs --at-risk-for-failed-verify PATH
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const defaultGraph = join(repoRoot, "infra/bootstrap_invariants.graph.json");
const defaultProgress = join(repoRoot, "bench_logs/bootstrap_state_progress.json");

const VERIFY_PHASE_TO_NODE = {
  workspace: "A.workspace",
  crypto: "B.crypto",
  infra: "C.infra",
  metrics: "C.metrics",
  images: "C.images",
  observability: "D.observability",
  transport: "E.transport",
  kafka_alignment: "F.kafka_alignment",
  app_runtime: "G.app_runtime",
};

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveProgress(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function predecessors(graph, node) {
  const preds = [];
  for (const [u, v] of graph.edges || []) {
    if (v === node) preds.push(u);
  }
  return preds;
}

function loadGraph(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function nowIso() {
  return new Date().toISOString();
}

function readProgress(progressPath) {
  const base = loadJson(progressPath, {
    version: "v1.0",
    completed: [],
    failed: [],
    sessionStartedAt: null,
    events: [],
  });
  if (!Array.isArray(base.completed)) base.completed = [];
  if (!Array.isArray(base.failed)) base.failed = [];
  if (!Array.isArray(base.events)) base.events = [];
  return base;
}

function appendEvent(progress, action, node, extra = {}) {
  const t0 = progress.sessionStartedAt ? Date.parse(progress.sessionStartedAt) : Date.now();
  const elapsedMs = Date.now() - t0;
  progress.events.push({
    ts: nowIso(),
    action,
    node,
    elapsedMsSinceSessionStart: elapsedMs,
    ...extra,
  });
}

function main() {
  const argv = process.argv;
  let graphPath = defaultGraph;
  let progressPath = defaultProgress;
  let mode = "";
  let argNode = "";
  let syncPath = "";
  let failMessage = "";
  let failLogFile = "";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--graph" && argv[i + 1]) graphPath = argv[++i];
    else if (a === "--progress" && argv[i + 1]) progressPath = argv[++i];
    else if (a === "--enter" && argv[i + 1]) {
      mode = "enter";
      argNode = argv[++i];
    } else if (a === "--complete" && argv[i + 1]) {
      mode = "complete";
      argNode = argv[++i];
    } else if (a === "--is-complete" && argv[i + 1]) {
      mode = "is-complete";
      argNode = argv[++i];
    } else if (a === "--fail" && argv[i + 1]) {
      mode = "fail";
      argNode = argv[++i];
    } else if (a === "--message" && argv[i + 1]) failMessage = argv[++i];
    else if (a === "--log-file" && argv[i + 1]) failLogFile = argv[++i];
    else if (a === "--reset") mode = "reset";
    else if (a === "--sync-verify-json" && argv[i + 1]) {
      mode = "sync-verify";
      syncPath = argv[++i];
    } else if (a === "--at-risk-for-failed-verify" && argv[i + 1]) {
      mode = "at-risk-verify";
      syncPath = argv[++i];
    }
  }

  const graph = loadGraph(graphPath);

  if (mode === "reset") {
    saveProgress(progressPath, {
      version: "v1.0",
      completed: [],
      failed: [],
      sessionStartedAt: nowIso(),
      events: [{ ts: nowIso(), action: "reset", node: null }],
    });
    console.log(JSON.stringify({ ok: true, progress: progressPath }, null, 2));
    return;
  }

  if (mode === "is-complete") {
    if (!argNode || !graph.nodes[argNode]) {
      console.error(`Unknown node: ${argNode}`);
      process.exit(2);
    }
    const progress0 = readProgress(progressPath);
    const done = progress0.completed.includes(argNode);
    console.log(JSON.stringify({ ok: true, node: argNode, complete: done }, null, 2));
    process.exit(done ? 0 : 1);
  }

  const progress = readProgress(progressPath);
  if (!progress.sessionStartedAt) {
    progress.sessionStartedAt = nowIso();
  }

  if (mode === "fail") {
    if (!argNode || !graph.nodes[argNode]) {
      console.error(`Unknown node: ${argNode}`);
      process.exit(2);
    }
    const msg = failMessage.trim() || "failed";
    progress.completed = progress.completed.filter((n) => n !== argNode);
    progress.failed = progress.failed.filter((f) => f.node !== argNode);
    /** @type {{ node: string; message: string; ts: string; logFile?: string }} */
    const rec = { node: argNode, message: msg, ts: nowIso() };
    if (failLogFile.trim()) rec.logFile = failLogFile.trim();
    progress.failed.push(rec);
    appendEvent(progress, "fail", argNode, { message: msg, logFile: failLogFile.trim() || undefined });
    saveProgress(progressPath, progress);
    console.log(JSON.stringify({ ok: false, failed: progress.failed }, null, 2));
    return;
  }

  if (mode === "complete") {
    if (!graph.nodes[argNode]) {
      console.error(`Unknown node: ${argNode}`);
      process.exit(1);
    }
    progress.failed = progress.failed.filter((f) => f.node !== argNode);
    if (!progress.completed.includes(argNode)) progress.completed.push(argNode);
    appendEvent(progress, "complete", argNode);
    saveProgress(progressPath, progress);
    console.log(JSON.stringify({ ok: true, completed: progress.completed }, null, 2));
    return;
  }

  if (mode === "enter") {
    if (!graph.nodes[argNode]) {
      console.error(`Unknown node: ${argNode}`);
      process.exit(1);
    }
    const preds = predecessors(graph, argNode);
    const missing = preds.filter((p) => !progress.completed.includes(p));
    if (missing.length) {
      console.error(`Illegal execution order:\n${argNode} requires:\n${missing.map((m) => `  - ${m}`).join("\n")}`);
      process.exit(1);
    }
    appendEvent(progress, "enter", argNode);
    saveProgress(progressPath, progress);
    console.log(JSON.stringify({ ok: true, enter: argNode, prerequisites: preds }, null, 2));
    return;
  }

  if (mode === "sync-verify") {
    const doc = JSON.parse(readFileSync(syncPath, "utf8"));
    const pr = doc.phase_results || {};
    for (const [phase, nodeId] of Object.entries(VERIFY_PHASE_TO_NODE)) {
      const r = pr[phase];
      if (r && r.ok === true && !r.skipped && !progress.completed.includes(nodeId)) {
        progress.completed.push(nodeId);
        appendEvent(progress, "sync-from-verify", nodeId, { verifyPhase: phase });
      }
    }
    saveProgress(progressPath, progress);
    console.log(JSON.stringify({ ok: true, completed: progress.completed }, null, 2));
    return;
  }

  if (mode === "at-risk-verify") {
    const doc = JSON.parse(readFileSync(syncPath, "utf8"));
    const pr = doc.phase_results || {};
    const failed = [];
    for (const [phase, nodeId] of Object.entries(VERIFY_PHASE_TO_NODE)) {
      const r = pr[phase];
      if (r && r.ok === false) failed.push(nodeId);
    }
    const graphFull = loadGraph(graphPath);
    const adj = new Map();
    for (const [u, v] of graphFull.edges || []) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push(v);
    }
    const downstreamAffected = new Set();
    const walkDown = (start) => {
      const stack = [start];
      while (stack.length) {
        const n = stack.pop();
        for (const v of adj.get(n) || []) {
          if (downstreamAffected.has(v)) continue;
          downstreamAffected.add(v);
          stack.push(v);
        }
      }
    };
    for (const n of failed) walkDown(n);
    const out = { failed_nodes: failed, downstream_affected: [...downstreamAffected] };
    console.log(JSON.stringify(out, null, 2));
    // Always exit 0: callers (e.g. bootstrap-drift-detector) consume JSON on stdout; verify RC drives severity.
    process.exit(0);
  }

  console.error(
    "Usage: --enter NODE | --complete NODE | --is-complete NODE | --fail NODE --message TEXT [--log-file PATH] | --reset | --sync-verify-json PATH | --at-risk-for-failed-verify PATH",
  );
  process.exit(2);
}

main();
