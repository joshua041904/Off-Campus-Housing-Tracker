#!/usr/bin/env node
/**
 * Lightweight model-check on service call graph: directed edges parent→child (different services).
 * Flags unexpected directed cycles (SCC size > 1). Missing required services is informational only.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const BENCH = join(REPO, "bench_logs");
const TRACE = join(BENCH, "trace_contract.json");
const OUT = join(BENCH, "trace-model-check-report.json");

const REQUIRED = new Set([
  "api-gateway",
  "auth-service",
  "listings-service",
  "booking-service",
  "messaging-service",
  "media-service",
  "notification-service",
  "trust-service",
  "analytics-service",
]);

function loadFirstTrace() {
  if (!existsSync(TRACE)) return null;
  try {
    const j = JSON.parse(readFileSync(TRACE, "utf8"));
    const t = j?.data?.[0];
    if (t?.spans && t.processes) return t;
    if (j?.spans && j.processes) return j;
    return null;
  } catch {
    return null;
  }
}

function serviceName(span, processes) {
  return processes?.[span.processID]?.serviceName || "unknown";
}

/** Tarjan SCC; returns array of components (each non-trivial cycle is |comp|>1). */
function tarjanScc(adj) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const sccs = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      sccs.push(comp);
    }
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) strongConnect(v);
  }
  return sccs;
}

function main() {
  mkdirSync(BENCH, { recursive: true });
  const trace = loadFirstTrace();
  if (!trace) {
    writeFileSync(OUT, `${JSON.stringify({ ok: true, skipped: true }, null, 2)}\n`);
    process.exit(0);
  }
  const { spans, processes } = trace;
  const seen = new Set();
  const adj = new Map();

  const byId = new Map(spans.map((s) => [s.spanID, s]));
  for (const s of spans) {
    const refs = Array.isArray(s.references) ? s.references : [];
    for (const r of refs) {
      if (r.refType !== "CHILD_OF" || !r.spanID) continue;
      const p = byId.get(r.spanID);
      if (!p) continue;
      const a = serviceName(p, processes);
      const b = serviceName(s, processes);
      if (a === b) continue;
      const key = `${a}→${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    }
  }

  const present = new Set(spans.map((s) => serviceName(s, processes)));
  const missing = [...REQUIRED].filter((x) => !present.has(x));
  const sccs = tarjanScc(adj);
  const badCycles = sccs.filter((c) => c.length > 1);

  const ok = badCycles.length === 0;
  const doc = {
    specVersion: "och-trace-model-lite-v1",
    ok,
    missing_required_services: missing,
    unexpected_cycles: badCycles,
    edge_count: seen.size,
  };
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  const strict = process.env.OCH_MODEL_CHECK_ENFORCE === "1" || process.env.PREFLIGHT_REQUIRE_FORMAL_TRACE_GATES === "1";
  if (!ok && strict) process.exit(1);
  process.exit(0);
}

main();
