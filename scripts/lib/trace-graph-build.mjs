/**
 * @typedef {{ from: string, to: string }} TraceEdge
 * @typedef {{ from: string, to: string, avg_ms: number, max_ms: number, samples: number }} WeightedEdge
 */
import { serviceName } from "../trace-validators/lib/jaeger-traces.mjs";
import { childOfParentSpanId } from "../trace-validators/lib/span-parent-ref.mjs";
import { jaegerDurationToMs } from "./trace-analysis.mjs";

function parentRef(span) {
  return childOfParentSpanId(span);
}

/**
 * @param {import("../trace-validators/lib/jaeger-traces.mjs").normalizeTrace} trace
 * @returns {TraceEdge[]}
 */
export function buildCallGraphEdges(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const byId = new Map(spans.map((s) => [String(s.spanID), s]));
  const edges = [];
  const seen = new Set();
  for (const span of spans) {
    const pid = parentRef(span);
    if (!pid) continue;
    const parent = byId.get(pid);
    if (!parent) continue;
    const from = serviceName(parent, processes);
    const to = serviceName(span, processes);
    if (!from || !to || from === to) continue;
    const key = `${from}\t${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to });
  }
  return edges;
}

/**
 * @param {import("../trace-validators/lib/jaeger-traces.mjs").normalizeTrace} trace
 * @returns {WeightedEdge[]}
 */
export function buildWeightedCallGraph(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const byId = new Map(spans.map((s) => [String(s.spanID), s]));
  /** @type {Map<string, number[]>} */
  const samples = new Map();
  for (const span of spans) {
    const pid = parentRef(span);
    if (!pid) continue;
    const parent = byId.get(pid);
    if (!parent) continue;
    const from = serviceName(parent, processes);
    const to = serviceName(span, processes);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const ms = jaegerDurationToMs(span.duration);
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key).push(ms);
  }
  const out = [];
  for (const [key, vals] of samples) {
    const [from, to] = key.split("->");
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    out.push({
      from,
      to,
      avg_ms: Math.round(avg * 10) / 10,
      max_ms: Math.round(max * 10) / 10,
      samples: vals.length,
    });
  }
  out.sort((a, b) => b.avg_ms - a.avg_ms);
  return out;
}
