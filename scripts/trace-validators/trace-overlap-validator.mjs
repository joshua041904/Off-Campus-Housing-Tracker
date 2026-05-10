#!/usr/bin/env node
/**
 * Temporal overlap invariants O1–O4 (parent containment, Kafka async gap bound, root envelope).
 * See docs/observability/och-observability-integrity-spec-v1.md §4.
 */
import { spanMap, tagValue, serviceName } from "./lib/jaeger-traces.mjs";
import { childOfParentSpanId } from "./lib/span-parent-ref.mjs";
import { effectiveTraceRoots } from "./step7-strict-span-invariant.mjs";

function parentRef(span) {
  return childOfParentSpanId(span);
}

/**
 * @param {object} trace
 * @param {{ epsilonUs?: number, kafkaMaxGapUs?: number }} opts — microseconds tolerances
 */
export function validateOverlapInvariant(trace, opts = {}) {
  const violations = [];
  const spans = trace.spans || [];
  const processes = trace.processes || {};
  const eps = opts.epsilonUs ?? 5000;
  const kafkaMax = opts.kafkaMaxGapUs ?? 10_000_000;

  const byId = spanMap(spans);
  for (const c of spans) {
    const pid = parentRef(c);
    if (!pid) continue;
    const p = byId.get(pid);
    if (!p) continue;
    const pStart = p.startTime ?? 0;
    const pEnd = pStart + (p.duration ?? 0);
    const cStart = c.startTime ?? 0;
    const cEnd = cStart + (c.duration ?? 0);
    if (cStart + eps < pStart) {
      violations.push({
        rule: "O1",
        detail: `child ${c.spanID} starts before parent ${p.spanID}`,
      });
    }
    if (cEnd > pEnd + eps) {
      violations.push({
        rule: "O1",
        detail: `child ${c.spanID} ends after parent window`,
      });
    }
  }

  const rts = effectiveTraceRoots(spans);
  if (rts.length === 1) {
    const root = rts[0];
    const rStart = root.startTime ?? 0;
    const rEnd = rStart + (root.duration ?? 0);
    let minS = Infinity;
    let maxE = -Infinity;
    for (const s of spans) {
      const st = s.startTime ?? 0;
      const en = st + (s.duration ?? 0);
      minS = Math.min(minS, st);
      maxE = Math.max(maxE, en);
    }
    const envEps = Number(process.env.STEP7_ROOT_ENVELOPE_EPS_US || "50000");
    const rootEps = Math.max(eps, envEps);
    if (minS + rootEps < rStart) {
      violations.push({ rule: "O3", detail: "root does not envelope min(span.start)" });
    }
    if (maxE > rEnd + rootEps) {
      violations.push({ rule: "O3", detail: "root does not envelope max(span.end)" });
    }
  }

  const producers = [];
  const consumers = [];
  for (const s of spans) {
    const k = String(tagValue(s, "span.kind") || "").toLowerCase();
    const sys = String(tagValue(s, "messaging.system") || "").toLowerCase();
    if (sys !== "kafka") continue;
    const topic = tagValue(s, "messaging.destination") || tagValue(s, "messaging.destination.name");
    const st = s.startTime ?? 0;
    const en = st + (s.duration ?? 0);
    if (k === "producer") producers.push({ span: s, topic, start: st, end: en });
    if (k === "consumer") consumers.push({ span: s, topic, start: st, end: en });
  }
  for (const pr of producers) {
    const match = consumers.find(
      (c) =>
        (!pr.topic || !c.topic || String(c.topic) === String(pr.topic)) &&
        c.start >= pr.end &&
        c.start - pr.end <= kafkaMax,
    );
    if (!match && producers.length && consumers.length) {
      violations.push({
        rule: "O4",
        detail: `no consumer within ${kafkaMax / 1e6}s after produce for topic ${pr.topic || "?"}`,
      });
      break;
    }
  }

  return { ok: violations.length === 0, violations };
}
