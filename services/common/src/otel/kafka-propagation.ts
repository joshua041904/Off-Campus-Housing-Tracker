import type { TextMapGetter } from "@opentelemetry/api";
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

/**
 * KafkaJS message headers: string or Buffer values (and optional arrays).
 * OpenTelemetry W3C keys (traceparent, tracestate, baggage) are injected as UTF-8 buffers.
 */
export type KafkaMessageHeaders = Record<string, string | Buffer | (string | Buffer)[] | undefined>;

function headerValueToString(v: string | Buffer | (string | Buffer)[] | undefined | null): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (Array.isArray(v)) {
    const first = v[0];
    if (first == null) return undefined;
    return Buffer.isBuffer(first) ? first.toString("utf8") : String(first);
  }
  return undefined;
}

/**
 * Merge optional existing headers with W3C trace context from {@link context.active()}.
 * Propagation runs on string carriers (W3C), then values are UTF-8 buffers for KafkaJS.
 */
/** Buffer-valued headers match KafkaJS `IHeaders` and avoid `null` in the index signature. */
export function buildKafkaMessageHeaders(existing?: KafkaMessageHeaders): Record<string, Buffer> {
  const stringCarrier: Record<string, string> = {};
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      if (v == null) continue;
      const s = headerValueToString(v);
      if (s !== undefined) stringCarrier[k] = s;
    }
  }
  propagation.inject(context.active(), stringCarrier, {
    set(h, key, value) {
      h[key] = value;
    },
  });
  const out: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(stringCarrier)) {
    out[k] = Buffer.from(v, "utf8");
  }
  return out;
}

const stringHeaderGetter: TextMapGetter<Record<string, string>> = {
  keys(carrier) {
    return Object.keys(carrier);
  },
  get(carrier, key) {
    const v = carrier[key] ?? carrier[key.toLowerCase()];
    return v;
  },
};

/** Extract trace context for continuing a trace started on the producer. */
export function extractKafkaMessageContext(
  headers: KafkaMessageHeaders | undefined | Record<string, unknown>,
): ReturnType<typeof context.active> {
  if (!headers || typeof headers !== "object" || Object.keys(headers).length === 0) {
    return context.active();
  }
  const stringCarrier: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) continue;
    const s = headerValueToString(v as string | Buffer | (string | Buffer)[] | undefined | null);
    if (s !== undefined) stringCarrier[k] = s;
  }
  if (Object.keys(stringCarrier).length === 0) {
    return context.active();
  }
  // Merge remote trace from headers into an empty root — not into whatever span happens to be active
  // (avoids corrupt links when extract runs under an unrelated parent).
  return propagation.extract(ROOT_CONTEXT, stringCarrier, stringHeaderGetter);
}

/**
 * Run consumer work as a child of the trace carried in Kafka headers (template: `kafka-consumer` tracer).
 */
export async function withKafkaConsumerSpan(
  headers: KafkaMessageHeaders | undefined | Record<string, unknown>,
  spanName: string,
  fn: () => Promise<void>,
  attributes?: Record<string, string | number | boolean>,
): Promise<void> {
  const parentCtx = extractKafkaMessageContext(headers);
  const tracer = trace.getTracer("kafka-consumer");
  const span = tracer.startSpan(spanName, {
    kind: SpanKind.CONSUMER,
    ...(attributes ? { attributes } : {}),
  }, parentCtx);
  const ctx = trace.setSpan(parentCtx, span);
  try {
    await context.with(ctx, fn);
  } finally {
    span.end();
  }
}

/** Golden-path alias (template `kafka/tracing.ts`): inject into a string map; prefer {@link buildKafkaMessageHeaders} for KafkaJS. */
export function injectTraceHeaders(existing?: Record<string, string>): Record<string, string> {
  const carrier: Record<string, string> = { ...existing };
  propagation.inject(context.active(), carrier, {
    set(h, key, value) {
      h[key] = value;
    },
  });
  return carrier;
}

/** Golden-path alias: returns a context with remote span from headers (use with `context.with`). */
export function extractTrace(headers: KafkaMessageHeaders | undefined | Record<string, unknown>) {
  return extractKafkaMessageContext(headers);
}

/** Start a span named `kafka:{topic}` (child of current context unless you pass a parent). */
export function startKafkaSpan(topic: string) {
  const tracer = trace.getTracer("kafka-tracer");
  return tracer.startSpan(`kafka:${topic}`);
}

/**
 * Child span around `producer.send`, on the active context, so inject sees the same trace.
 * Use for golden-path “produce” hops in Jaeger.
 */
export async function withKafkaProduceSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("kafka-producer");
  const span = tracer.startSpan(spanName, { kind: SpanKind.PRODUCER, attributes });
  const ctx = trace.setSpan(context.active(), span);
  try {
    return await context.with(ctx, fn);
  } catch (e) {
    span.recordException(e instanceof Error ? e : new Error(String(e)));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    span.end();
  }
}
