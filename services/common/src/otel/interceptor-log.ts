import type { Span } from "@opentelemetry/api";
import { logger } from "../logger.js";

function interceptorLog(): typeof logger.info {
  return process.env.OCH_INTERCEPTOR_ACCESS_LOG === "1" || process.env.OCH_INTERCEPTOR_ACCESS_LOG === "true"
    ? logger.info.bind(logger)
    : logger.debug.bind(logger);
}

function traceFields(span: Span): { trace_id: string; span_id: string } {
  const sc = span.spanContext();
  return { trace_id: sc.traceId, span_id: sc.spanId };
}

/** Structured line: HTTP hop (middleware / interceptor layer). */
export function logHttpInterceptorFinish(params: {
  method: string;
  route: string;
  statusCode: number;
  latencyMs: number;
  span: Span;
  /** api-gateway `X-Trace-Id` (UUID) — correlate with edge headers when OTel trace_id differs. */
  x_trace_id?: string;
}): void {
  const base = {
    msg: "http.interceptor",
    layer: "http",
    method: params.method,
    route: params.route,
    status_code: params.statusCode,
    latency_ms: Math.round(params.latencyMs * 1000) / 1000,
    ...traceFields(params.span),
  };
  const xtid = (params.x_trace_id || "").trim();
  interceptorLog()(
    xtid ? { ...base, x_trace_id: xtid } : base,
  );
}

/** Structured line: gRPC server RPC complete. */
export function logGrpcServerInterceptorFinish(params: {
  path: string;
  grpcStatusCode: number;
  latencyMs: number;
  span: Span;
}): void {
  interceptorLog()({
    msg: "grpc.server.interceptor",
    layer: "grpc_server",
    path: params.path,
    grpc_status_code: params.grpcStatusCode,
    latency_ms: Math.round(params.latencyMs * 1000) / 1000,
    ...traceFields(params.span),
  });
}

/** Structured line: gRPC client call complete. */
export function logGrpcClientInterceptorFinish(params: {
  path: string;
  grpcStatusCode: number;
  latencyMs: number;
  span: Span;
}): void {
  interceptorLog()({
    msg: "grpc.client.interceptor",
    layer: "grpc_client",
    path: params.path,
    grpc_status_code: params.grpcStatusCode,
    latency_ms: Math.round(params.latencyMs * 1000) / 1000,
    ...traceFields(params.span),
  });
}
