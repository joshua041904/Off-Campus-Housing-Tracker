import * as grpc from "@grpc/grpc-js";
import { context, propagation, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { grpcMetadataSetter } from "./grpc-metadata.js";
import { logGrpcClientInterceptorFinish } from "./interceptor-log.js";

const metadataSetter = grpcMetadataSetter();

/**
 * gRPC-js client interceptor: child span, inject W3C trace context into call metadata, end on status.
 */
export function createGrpcClientTracingInterceptor(): grpc.Interceptor {
  return (options, nextCall) =>
    new grpc.InterceptingCall(nextCall(options), {
      start: (metadata, listener, next) => {
        const tracer = trace.getTracer("grpc-tracer");
        const path = options.method_definition.path;
        const parent = context.active();
        const span = tracer.startSpan(`gRPC ${path}`, {}, parent);
        const spanCtx = trace.setSpan(parent, span);
        const startHr = process.hrtime.bigint();
        propagation.inject(spanCtx, metadata, metadataSetter);

        const wrappedListener: grpc.InterceptingListener = {
          onReceiveMetadata: (m) => listener.onReceiveMetadata(m),
          onReceiveMessage: (msg) => listener.onReceiveMessage(msg),
          onReceiveStatus: (status) => {
            const latencyMs = Number(process.hrtime.bigint() - startHr) / 1e6;
            finishClientSpan(span, status, path, latencyMs);
            listener.onReceiveStatus(status);
          },
        };

        context.with(spanCtx, () => {
          next(metadata, wrappedListener);
        });
      },
    });
}

function finishClientSpan(span: Span, status: grpc.StatusObject, path: string, latencyMs: number): void {
  span.setAttribute("rpc.grpc.status_code", status.code);
  span.setAttribute("rpc.grpc.latency_ms", latencyMs);
  if (status.code !== grpc.status.OK) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: status.details });
  }
  logGrpcClientInterceptorFinish({
    path,
    grpcStatusCode: status.code,
    latencyMs,
    span,
  });
  span.end();
}

/**
 * gRPC-js {@link grpc.Interceptor} (template name). Uses {@link grpc.InterceptingCall} + metadata
 * propagation; your snippet’s `new nextCall(options, …)` is not the grpc-js API.
 */
export const tracingInterceptor: grpc.Interceptor = createGrpcClientTracingInterceptor();
