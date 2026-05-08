/**
 * Jaeger span parent resolution — use **CHILD_OF** only.
 * Do not fall back to `references[0]`: FOLLOW_FROM / other ref types caused false
 * parentage and "expected 1 root, got 0" when every span carried a non-CHILD_OF ref.
 */

/** Known placeholder / invalid remote parent span IDs (OTel/Jaeger batch without remote parent). */
export const MISSING_REMOTE_PARENT_SPAN_IDS = new Set(["0000000000000000", "0000000000000001"]);

/**
 * @param {object} span — Jaeger span
 * @returns {string|null}
 */
export function childOfParentSpanId(span) {
  const refs = span.references || [];
  const co = refs.find((r) => r.refType === "CHILD_OF");
  if (!co?.spanID) return null;
  return String(co.spanID);
}
