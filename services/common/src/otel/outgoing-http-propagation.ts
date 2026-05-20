import type { Context, TextMapSetter } from "@opentelemetry/api";
import { context, propagation, trace, SpanStatusCode } from "@opentelemetry/api";
import type { ClientRequest, IncomingMessage } from "node:http";

const clientRequestSetter: TextMapSetter<ClientRequest> = {
  set(carrier, key, value) {
    carrier.setHeader(key, value);
  },
};

const stringRecordSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    carrier[key] = value;
  },
};

const headersSetter: TextMapSetter<Headers> = {
  set(carrier, key, value) {
    carrier.set(key, value);
  },
};

/** Express async handlers lose ALS after `await`; stash the per-request span context for outbound inject. */
const incomingHttpOtelContext = new WeakMap<IncomingMessage, Context>();

export function attachIncomingHttpOtelContext(req: IncomingMessage, ctx: Context): void {
  incomingHttpOtelContext.set(req, ctx);
}

export function getIncomingHttpOtelContext(req: IncomingMessage): Context | undefined {
  return incomingHttpOtelContext.get(req);
}

/** True when bootstrap skipped OpenTelemetry (no-op propagation). */
function otelDisabled(): boolean {
  return process.env.OTEL_SDK_DISABLED === "true" || process.env.OTEL_SDK_DISABLED === "1";
}

/**
 * Inject W3C trace context (`traceparent`, `tracestate`, …) into an outbound
 * {@link ClientRequest} (e.g. http-proxy-middleware `proxyReq`) so upstream HTTP
 * services can {@link propagation.extract} in {@link tracingMiddleware}.
 * Pass the inbound Express `req` when the handler may have crossed an `await` (AsyncLocalStorage no longer has the request span).
 */
export function injectTraceContextIntoClientRequest(proxyReq: ClientRequest, req?: IncomingMessage): void {
  if (otelDisabled()) return;
  const ctx = req ? getIncomingHttpOtelContext(req) ?? context.active() : context.active();
  propagation.inject(ctx, proxyReq, clientRequestSetter);
}

/**
 * Build headers for `http.get` / `http.request` with the current trace context.
 */
export function buildOutgoingHttpHeadersWithTrace(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (otelDisabled()) return headers;
  propagation.inject(context.active(), headers, stringRecordSetter);
  return headers;
}

/**
 * Prefer the {@link attachIncomingHttpOtelContext} context for this request (survives Express async `await`),
 * else fall back to {@link context.active}.
 */
export function buildOutgoingHttpHeadersForIncomingMessage(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  if (otelDisabled()) return headers;
  const ctx = incomingHttpOtelContext.get(req) ?? context.active();
  propagation.inject(ctx, headers, stringRecordSetter);
  return headers;
}

/** Inject from an explicit {@link Context} (e.g. captured synchronously before Express async `await`). */
export function buildOutgoingHttpHeadersFromContext(ctx: Context): Record<string, string> {
  const headers: Record<string, string> = {};
  if (otelDisabled()) return headers;
  propagation.inject(ctx, headers, stringRecordSetter);
  return headers;
}

export type TracedFetchInit = RequestInit & {
  /** When set, inject `traceparent` / `tracestate` from this context (e.g. sync-captured gateway request context). */
  propagationContext?: Context;
};

function httpClientTracer() {
  return trace.getTracer("och-http-client");
}

/**
 * `fetch` with W3C context injection and an explicit outbound span.
 *
 * Uses {@link propagation.inject} on {@link context.active} while the client span is active, with an
 * explicit parent {@link Context} when provided (survives Express async gaps). Disabling
 * `@opentelemetry/instrumentation-undici` in {@link startNodeTelemetry} avoids fetch being re-patched
 * with a conflicting inject path.
 */
export async function tracedFetch(url: string | URL, init: TracedFetchInit = {}): Promise<Response> {
  const { propagationContext, ...fetchInit } = init;
  const parentCtx = propagationContext ?? context.active();
  const href = typeof url === "string" ? url : url.href;

  return httpClientTracer().startActiveSpan(
    "HTTP GET",
    {
      attributes: {
        "url.full": href,
        "network.protocol.name": "http",
        "network.protocol.version": "unknown",
        "och.upstream_proto": "unknown",
      },
    },
    parentCtx,
    async (span) => {
      try {
        const headers = new Headers((fetchInit.headers as HeadersInit | undefined) ?? undefined);
        if (!otelDisabled()) {
          propagation.inject(context.active(), headers, headersSetter);
        }
        const res = await fetch(url, { ...fetchInit, headers });
        span.setAttribute("http.status_code", res.status);
        if (!res.ok) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.status}` });
        }
        return res;
      } catch (e) {
        span.recordException(e instanceof Error ? e : new Error(String(e)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}
