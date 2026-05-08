#!/usr/bin/env node
/**
 * Step 7B — structural span-tree invariant on a single Jaeger trace.
 * See docs/observability/och-observability-integrity-spec-v1.md §3.
 */
import { spanMap, tagValue, serviceName } from "./lib/jaeger-traces.mjs";
import { childOfParentSpanId, MISSING_REMOTE_PARENT_SPAN_IDS } from "./lib/span-parent-ref.mjs";

/** Every span must have Jaeger tag `net.proto` (set from OTEL in housing services). */
export function traceSpansHaveNetProto(trace) {
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const violations = [];
  for (const s of spans) {
    const sn = serviceName(s, processes);
    if (/envoy/i.test(sn)) continue;
    if (tagValue(s, "db.system") != null) continue;
    if (tagValue(s, "messaging.system") != null) continue;
    const v = tagValue(s, "net.proto");
    if (v == null || String(v).trim() === "") {
      violations.push({
        rule: "S_proto",
        detail: `span ${s.spanID} (${sn}) missing net.proto`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Jaeger/OpenTelemetry parent span id from **CHILD_OF** only (see lib/span-parent-ref.mjs). */
export function parentRef(span) {
  return childOfParentSpanId(span);
}

/** Structural roots: no CHILD_OF, remote placeholder parent, or parent span missing from this Jaeger batch. */
export function effectiveTraceRoots(spans) {
  const byId = spanMap(spans);
  return spans.filter((s) => {
    const pid = parentRef(s);
    if (!pid) return true;
    if (MISSING_REMOTE_PARENT_SPAN_IDS.has(pid)) return true;
    if (!byId.has(pid)) return true;
    return false;
  });
}

function roots(spans) {
  return effectiveTraceRoots(spans);
}

/**
 * @param {object} trace — Jaeger trace object
 * @param {{ minSpanCount?: number, minDepth?: number, requiredServices?: string[], requireNetProto?: boolean }} opts
 */
export function validateSpanTreeInvariant(trace, opts = {}) {
  const violations = [];
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const minSpan = opts.minSpanCount ?? 4;
  const minDepth = opts.minDepth ?? 2;
  const required = (opts.requiredServices || []).map((s) => s.trim()).filter(Boolean);

  if (spans.length < minSpan) {
    violations.push({ rule: "S0", detail: `span_count ${spans.length} < ${minSpan}` });
  }

  const ids = spans.map((s) => String(s.spanID));
  const uniq = new Set(ids);
  if (uniq.size !== ids.length) {
    violations.push({ rule: "S4", detail: "duplicate spanID" });
  }

  const rts = roots(spans);
  if (rts.length !== 1) {
    violations.push({ rule: "S1", detail: `expected 1 root, got ${rts.length}` });
  }

  const byId = spanMap(spans);
  for (const s of spans) {
    const pid = parentRef(s);
    if (!pid) continue;
    if (!byId.has(pid) && !MISSING_REMOTE_PARENT_SPAN_IDS.has(pid)) {
      violations.push({
        rule: "S3",
        detail: `orphan reference parent ${pid} for span ${s.spanID}`,
      });
    }
  }

  /** Walk parent chain from each span; repeat spanID on one walk ⇒ cycle */
  function hasCycle() {
    for (const start of spans) {
      const chain = new Set();
      let cur = start;
      for (let i = 0; i < spans.length + 2; i++) {
        const sid = String(cur.spanID);
        if (chain.has(sid)) return true;
        chain.add(sid);
        const p = parentRef(cur);
        if (!p) break;
        const next = byId.get(p);
        if (!next) break;
        cur = next;
      }
    }
    return false;
  }
  if (hasCycle()) {
    violations.push({ rule: "S5", detail: "parent reference cycle detected" });
  }

  function maxDepth() {
    const memo = new Map();
    function d(span) {
      const sid = String(span.spanID);
      if (memo.has(sid)) return memo.get(sid);
      const p = parentRef(span);
      const parent = p ? byId.get(p) : null;
      const v = parent ? 1 + d(parent) : 1;
      memo.set(sid, v);
      return v;
    }
    let mx = 0;
    for (const s of spans) mx = Math.max(mx, d(s));
    return mx;
  }
  const depth = maxDepth();
  if (depth < minDepth) {
    violations.push({ rule: "S_depth", detail: `max_depth ${depth} < ${minDepth}` });
  }

  const svcs = [...new Set(spans.map((s) => serviceName(s, processes)))];
  for (const req of required) {
    if (!svcs.some((x) => x === req || x.includes(req))) {
      violations.push({ rule: "S_services", detail: `missing service ${req}; have ${svcs.join(",")}` });
    }
  }

  if (opts.requireNetProto === true) {
    const pr = traceSpansHaveNetProto(trace);
    violations.push(...pr.violations);
  }

  return { ok: violations.length === 0, violations, spanCount: spans.length, depth, services: svcs };
}
