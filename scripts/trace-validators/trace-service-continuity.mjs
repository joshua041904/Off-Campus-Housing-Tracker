#!/usr/bin/env node
/**
 * Trace service-chain diagnostics (Jaeger JSON): which processes appear, overlap, missing expected services.
 * Used by check-trace-continuity.mjs and optionally Step 7 gates for actionable errors.
 */
import { serviceName, spanMap, normalizeTrace } from "./lib/jaeger-traces.mjs";
import { childOfParentSpanId } from "./lib/span-parent-ref.mjs";

function parentRef(span) {
  return childOfParentSpanId(span);
}

/** @param {object} trace */
export function servicesInTrace(trace) {
  const t = normalizeTrace(trace);
  if (!t?.spans?.length) return [];
  const processes = t.processes || {};
  const set = new Set();
  for (const s of t.spans) {
    set.add(serviceName(s, processes));
  }
  return [...set];
}

/** Every span's traceID must match the trace root (Jaeger may use mixed case). */
export function validateSingleTraceIdConsistency(trace) {
  const t = normalizeTrace(trace);
  const violations = [];
  if (!t?.traceID || !t?.spans?.length) {
    violations.push({ rule: "T0", detail: "missing traceID or spans" });
    return { ok: false, violations };
  }
  const root = String(t.traceID).toLowerCase();
  for (const s of t.spans) {
    const sid = s.traceID != null ? String(s.traceID).toLowerCase() : "";
    if (sid && sid !== root) {
      violations.push({
        rule: "T1",
        detail: `span ${s.spanID} traceID ${sid} != root ${root}`,
      });
    }
  }
  return { ok: violations.length === 0, violations, traceId: root };
}

/** True if some pair of spans overlaps in time (microseconds). */
export function hasTemporalOverlap(trace) {
  const t = normalizeTrace(trace);
  if (!t?.spans?.length) return false;
  const spans = t.spans;
  const intervals = spans.map((s) => {
    const st = s.startTime ?? 0;
    const en = st + (s.duration ?? 0);
    return { st, en };
  });
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      if (a.st < b.en && b.st < a.en) return true;
    }
  }
  return false;
}

/**
 * @param {object} trace — Jaeger trace
 * @param {string[]} required — service names or substrings (e.g. api-gateway, auth-service)
 */
export function diagnoseServiceChain(trace, required) {
  const t = normalizeTrace(trace);
  const out = {
    traceID: t?.traceID || null,
    services: servicesInTrace(t),
    missing: [],
    overlap: false,
    spanCount: t?.spans?.length ?? 0,
  };
  if (!t?.spans?.length) return out;
  out.overlap = hasTemporalOverlap(t);
  for (const req of required) {
    const ok = out.services.some((x) => x === req || x.includes(req));
    if (!ok) out.missing.push(req);
  }
  const byId = spanMap(t.spans);
  let orphanRefs = 0;
  for (const s of t.spans) {
    const pid = parentRef(s);
    if (pid && !byId.has(pid)) orphanRefs++;
  }
  out.orphanParentRefs = orphanRefs;
  return out;
}
