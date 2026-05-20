import type { TextMapGetter } from "@opentelemetry/api";
import { context, propagation, trace, SpanStatusCode } from "@opentelemetry/api";
import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { httpRequestDurationSeconds } from "../metrics.js";
import { logHttpInterceptorFinish } from "./interceptor-log.js";
import { isOchTraceDebugLogEnabled, logTraceDebug } from "./trace-debug-log.js";
import {
  decorateHttpSpanWithTransport,
  decorateIncomingMessageSpanWithTransport,
  edgeProtoFromIncomingMessage,
  edgeProtoFromRequestHeaders,
} from "./net-protocol.js";
import { attachIncomingHttpOtelContext } from "./outgoing-http-propagation.js";

/** Resolve at call time so tests (and any import order) see the registered global `TracerProvider`. */
function httpTracer() {
  return trace.getTracer("http-tracer");
}

const headerGetter: TextMapGetter<Request> = {
  keys(req) {
    return Object.keys(req.headers);
  },
  get(req, key) {
    const v = req.headers[key.toLowerCase()];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.join(",");
    return undefined;
  },
};

const incomingHeaderGetter: TextMapGetter<IncomingMessage> = {
  keys(req) {
    return Object.keys(req.headers);
  },
  get(req, key) {
    const v = req.headers[key.toLowerCase()];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.join(",");
    return undefined;
  },
};

/** Fire once when the response is done or the socket closes (raw Node may not always emit `finish`). */
function whenResponseDone(res: { once(ev: "finish" | "close", fn: () => void): void }, fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  res.once("finish", run);
  res.once("close", run);
}

/**
 * Express tracing middleware (same shape as a typical `src/middleware/tracing.ts` recipe), plus
 * W3C trace context extraction so parent spans propagate from gateways / browsers.
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void | ReturnType<NextFunction> {
  const extracted = propagation.extract(context.active(), req, headerGetter);
  const span = httpTracer().startSpan(`HTTP ${req.method} ${req.path}`, {}, extracted);
  decorateHttpSpanWithTransport(span, req);
  const ctx = trace.setSpan(extracted, span);
  attachIncomingHttpOtelContext(req, ctx);
  const start = process.hrtime.bigint();

  if (isOchTraceDebugLogEnabled()) {
    const svc = process.env.OTEL_SERVICE_NAME?.trim() || "http";
    const tp =
      typeof req.get === "function"
        ? req.get("traceparent") || req.get("Traceparent") || undefined
        : undefined;
    context.with(ctx, () => logTraceDebug(svc, tp));
  }

  whenResponseDone(res, () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;

    const xTrace = typeof (req as { traceId?: string }).traceId === "string" ? (req as { traceId?: string }).traceId : undefined;
    span.setAttributes({
      "http.method": req.method,
      "http.route": req.path,
      "http.status_code": res.statusCode,
      "http.latency_ms": durationMs,
      ...(xTrace ? { "och.x_trace_id": xTrace } : {}),
    });

    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute("net.error", `http_${res.statusCode}`);
    }

    logHttpInterceptorFinish({
      method: req.method,
      route: req.path,
      statusCode: res.statusCode,
      latencyMs: durationMs,
      span,
      x_trace_id: xTrace,
    });

    httpRequestDurationSeconds.observe(
      {
        service: process.env.OTEL_SERVICE_NAME?.trim() || "http",
        route: req.path,
        method: req.method,
        code: String(res.statusCode),
        proto: edgeProtoFromRequestHeaders(req),
      },
      durationMs / 1000,
    );

    span.end();
  });

  // Run the rest of the Express chain inside this request context. Stash `ctx` on `req` as well so
  // async route handlers can still inject W3C headers after `await` (ALS is lost across Express async gaps).
  return void context.with(ctx, () => next());
}

/**
 * Trace a raw Node `http` request (services without Express still get start/end spans on `res` "finish").
 */
export async function traceIncomingHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routePath: string,
  handler: () => void | Promise<void>,
): Promise<void> {
  const method = req.method ?? "GET";
  const extracted = propagation.extract(context.active(), req, incomingHeaderGetter);
  const span = httpTracer().startSpan(`HTTP ${method} ${routePath}`, {}, extracted);
  decorateIncomingMessageSpanWithTransport(span, req);
  const ctx = trace.setSpan(extracted, span);
  attachIncomingHttpOtelContext(req, ctx);
  const start = process.hrtime.bigint();

  whenResponseDone(res, () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;

    span.setAttributes({
      "http.method": method,
      "http.route": routePath,
      "http.status_code": res.statusCode,
      "http.latency_ms": durationMs,
    });

    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute("net.error", `http_${res.statusCode}`);
    }

    logHttpInterceptorFinish({
      method,
      route: routePath,
      statusCode: res.statusCode,
      latencyMs: durationMs,
      span,
    });

    httpRequestDurationSeconds.observe(
      {
        service: process.env.OTEL_SERVICE_NAME?.trim() || "http",
        route: routePath,
        method,
        code: String(res.statusCode),
        proto: edgeProtoFromIncomingMessage(req),
      },
      durationMs / 1000,
    );

    span.end();
  });

  await context.with(ctx, async () => {
    await handler();
  });
}

/** @deprecated Use {@link tracingMiddleware} (fixed `http-tracer` instrument name). */
export function createHttpTracingMiddleware(_tracerName?: string) {
  return tracingMiddleware;
}
