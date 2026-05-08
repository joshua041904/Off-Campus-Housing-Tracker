/**
 * W3C Trace Context `traceparent` for k6 (valid 32-char trace id + 16-char parent span id).
 * Use on every outbound request so Jaeger proofs can correlate injected ids with OTEL spans.
 */
export function randomHex(n) {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < n; i++) s += h[Math.floor(Math.random() * 16)];
  return s;
}

/** @returns {{ traceparent: string, traceId: string, parentSpanId: string }} */
export function makeW3CTraceparent() {
  const traceId = randomHex(32);
  const parentSpanId = randomHex(16);
  const traceparent = `00-${traceId}-${parentSpanId}-01`;
  return { traceparent, traceId, parentSpanId };
}

/**
 * Merge a fresh traceparent into k6 request params (after mergeEdgeTls / mergeEdgeTlsWithProtocol).
 * @param {Record<string, unknown>} params
 */
export function injectTraceparentIntoParams(params) {
  const w3c = makeW3CTraceparent();
  const headers = Object.assign({}, params.headers || {}, { traceparent: w3c.traceparent });
  const tags = Object.assign({}, params.tags || {}, {
    injected_trace_id: w3c.traceId,
    trace_id: w3c.traceId,
  });
  return Object.assign({}, params, { headers: headers, tags: tags });
}
