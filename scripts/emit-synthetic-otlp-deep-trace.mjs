#!/usr/bin/env node
/**
 * Emit one synthetic OTLP/HTTP trace with a linear CHILD_OF chain (default depth 9) for Jaeger UI checks.
 *
 * Usage:
 *   kubectl -n observability port-forward svc/jaeger 4318:4318 &
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces node scripts/emit-synthetic-otlp-deep-trace.mjs
 *
 * In-cluster (from a pod with cluster DNS):
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://jaeger.observability.svc.cluster.local:4318/v1/traces node scripts/emit-synthetic-otlp-deep-trace.mjs
 *
 * Env:
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT — required (full URL ending in /v1/traces)
 *   SYNTHETIC_TRACE_DEPTH — default 9
 *   SYNTHETIC_SERVICE_NAME — default synthetic-deep-trace
 */
import crypto from "node:crypto";

const depth = Math.max(1, Math.min(64, Number.parseInt(process.env.SYNTHETIC_TRACE_DEPTH || "9", 10) || 9));
const serviceName = (process.env.SYNTHETIC_SERVICE_NAME || "synthetic-deep-trace").trim() || "synthetic-deep-trace";
const url = (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "").trim();
if (!url) {
  console.error(
    "Set OTEL_EXPORTER_OTLP_TRACES_ENDPOINT to the OTLP HTTP traces URL, e.g. http://127.0.0.1:4318/v1/traces (after port-forward to Jaeger).",
  );
  process.exit(1);
}

/** Jaeger OTLP/JSON accepts lowercase hex for trace/span IDs (32 / 16 hex chars). */
function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

const traceIdBytes = crypto.randomBytes(16);
const traceIdHex = hex(traceIdBytes);

const t0 = BigInt(Date.now()) * 1_000_000n;
const spanDuration = 50_000n; // 50µs per span

const spans = [];
let parentSpanIdHex = "";
for (let i = 1; i <= depth; i += 1) {
  const spanIdBytes = crypto.randomBytes(8);
  const spanIdHex = hex(spanIdBytes);
  const start = t0 + BigInt(i - 1) * spanDuration;
  const end = start + spanDuration;
  const span = {
    traceId: traceIdHex,
    spanId: spanIdHex,
    name: `synthetic.depth${i}`,
    kind: 1,
    startTimeUnixNano: String(start),
    endTimeUnixNano: String(end),
    attributes: [
      { key: "synthetic.depth", value: { intValue: i } },
      { key: "synthetic.chain", value: { stringValue: "linear-child-of" } },
    ],
  };
  if (parentSpanIdHex) span.parentSpanId = parentSpanIdHex;
  spans.push(span);
  parentSpanIdHex = spanIdHex;
}

const body = {
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
      },
      scopeSpans: [
        {
          scope: { name: "och-synthetic-trace", version: "1.0.0" },
          spans,
        },
      ],
    },
  ],
};

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const txt = await res.text().catch(() => "");
  console.error(`OTLP export failed: HTTP ${res.status} ${txt.slice(0, 500)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      depth,
      serviceName,
      traceIdHex,
      jaegerSearchHint: `http://127.0.0.1:16686/search?service=${encodeURIComponent(serviceName)}&lookback=1h`,
      note: "If using cluster Jaeger UI, open /jaeger/search and filter by this service name.",
    },
    null,
    2,
  ),
);
