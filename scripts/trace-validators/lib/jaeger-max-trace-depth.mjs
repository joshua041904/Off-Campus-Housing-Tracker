/**
 * Max span-tree depth for a Jaeger trace (longest path following CHILD_OF parents).
 * Depth 1 = single span with no parent.
 */
import { childOfParentSpanId } from "./span-parent-ref.mjs";

function spanMap(spans) {
  const m = new Map();
  for (const s of spans) {
    if (s?.spanID != null) m.set(String(s.spanID), s);
  }
  return m;
}

/**
 * @param {object[]} spans — Jaeger API trace.spans
 * @returns {number}
 */
export function maxTraceDepth(spans) {
  const list = Array.isArray(spans) ? spans : [];
  if (list.length === 0) return 0;
  const byId = spanMap(list);
  const memo = new Map();

  function depth(span) {
    const sid = String(span.spanID);
    if (memo.has(sid)) return memo.get(sid);
    const pid = childOfParentSpanId(span);
    const parent = pid ? byId.get(pid) : null;
    const d = parent ? 1 + depth(parent) : 1;
    memo.set(sid, d);
    return d;
  }

  let mx = 1;
  for (const s of list) mx = Math.max(mx, depth(s));
  return mx;
}
