/**
 * Jaeger trace analysis: critical path, per-service wall time, HTTP route from root span.
 * Durations: Jaeger Query API uses microseconds on spans.
 */
import { spanMap, tagValue, serviceName } from "../trace-validators/lib/jaeger-traces.mjs";
import { childOfParentSpanId } from "../trace-validators/lib/span-parent-ref.mjs";
import { effectiveTraceRoots } from "../trace-validators/step7-strict-span-invariant.mjs";

function parentRef(span) {
  return childOfParentSpanId(span);
}

function roots(spans) {
  return effectiveTraceRoots(spans);
}

/** @param {number} d Jaeger duration (microseconds) */
export function jaegerDurationToMs(d) {
  const n = Number(d) || 0;
  return n / 1000;
}

/**
 * Longest path by summed span duration (ms), from a root (coarse critical-path proxy).
 * @returns {{ criticalPathMs: number, path: { spanID: string, operationName: string, service: string, durationMs: number }[] }}
 */
export function computeCriticalPath(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const byId = spanMap(spans);
  const rts = roots(spans);
  if (!rts.length || !spans.length) {
    return { criticalPathMs: 0, path: [] };
  }
  const root = rts[0];

  function dfs(spanId) {
    const span = byId.get(String(spanId));
    if (!span) return { cost: 0, path: [] };
    const selfMs = jaegerDurationToMs(span.duration);
    const children = spans.filter((s) => parentRef(s) === String(spanId));
    let best = { cost: 0, path: [] };
    for (const ch of children) {
      const sid = String(ch.spanID);
      const sub = dfs(sid);
      if (sub.cost > best.cost) best = sub;
    }
    const step = {
      spanID: String(span.spanID),
      operationName: span.operationName || "",
      service: serviceName(span, processes),
      durationMs: selfMs,
    };
    return { cost: selfMs + best.cost, path: [step, ...best.path] };
  }

  const out = dfs(String(root.spanID));
  return { criticalPathMs: out.cost, path: out.path };
}

/** Sum span duration (ms) grouped by Jaeger service name. */
export function computeServiceContribution(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const map = {};
  for (const s of spans) {
    const sn = serviceName(s, processes);
    const ms = jaegerDurationToMs(s.duration);
    map[sn] = (map[sn] || 0) + ms;
  }
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return { byService: map, sorted };
}

/** Best-effort HTTP route / target from root span tags. */
export function extractRootHttpRoute(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const rts = roots(spans);
  if (!rts.length) return "unknown";
  const root = rts[0];
  const route = tagValue(root, "http.route") || tagValue(root, "http.target") || tagValue(root, "url.path");
  if (route) return String(route);
  const op = root.operationName || "";
  const m = op.match(/HTTP\s+\w+\s+(\S+)/);
  return m ? m[1] : op || "unknown";
}

export function maxTreeDepth(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const byId = spanMap(spans);
  function d(span) {
    const sid = String(span.spanID);
    const p = parentRef(span);
    const parent = p ? byId.get(p) : null;
    const v = parent ? 1 + d(parent) : 1;
    return v;
  }
  let mx = 0;
  for (const s of spans) mx = Math.max(mx, d(s));
  return mx;
}
