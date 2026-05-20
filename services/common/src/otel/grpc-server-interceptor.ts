import * as grpc from "@grpc/grpc-js";
import { context, propagation, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { grpcMetadataGetter } from "./grpc-metadata.js";
import { normalizeEdgeProto } from "./net-protocol.js";
import { logGrpcServerInterceptorFinish } from "./interceptor-log.js";
import { isOchTraceDebugLogEnabled, logTraceDebug } from "./trace-debug-log.js";

const metadataGetter = grpcMetadataGetter();

type InterceptorState = {
  span: Span | undefined;
  activeCtx: ReturnType<typeof context.active>;
  startHr: bigint;
};

/**
 * gRPC-js server interceptor: extract incoming trace context, span per RPC, record status + latency.
 */
export function createGrpcServerTracingInterceptor(): grpc.ServerInterceptor {
  return (methodDescriptor, nextCall) => {
    const state: InterceptorState = {
      span: undefined,
      activeCtx: context.active(),
      startHr: 0n,
    };

    return new grpc.ServerInterceptingCall(nextCall, {
      start: (next) => {
        const tracer = trace.getTracer("grpc-tracer");
        next({
          onReceiveMetadata: (metadata, nextMeta) => {
            const extracted = propagation.extract(context.active(), metadata, metadataGetter);
            state.span = tracer.startSpan(`gRPC ${methodDescriptor.path}`, {}, extracted);
            state.span.setAttribute("rpc.system", "grpc");
            state.span.setAttribute("network.protocol.name", "grpc");
            state.span.setAttribute("network.protocol.version", "2");
            state.span.setAttribute("och.upstream_proto", "grpc");
            const edgeHdr = metadataGetter.get(metadata, "x-och-edge-proto");
            const edgeRaw = Array.isArray(edgeHdr) ? edgeHdr[0] : edgeHdr;
            const edge = normalizeEdgeProto(edgeRaw != null ? String(edgeRaw) : undefined);
            if (edge !== "unknown") {
              state.span.setAttribute("och.edge_proto", edge);
            }
            const dbg = metadataGetter.get(metadata, "x-debug-replay");
            const dbgVal = Array.isArray(dbg) ? dbg[0] : dbg;
            const d = String(dbgVal ?? "")
              .trim()
              .toLowerCase();
            if (d === "1" || d === "true" || d === "yes") {
              state.span.setAttribute("debug.replay", true);
            }
            state.startHr = process.hrtime.bigint();
            state.activeCtx = trace.setSpan(extracted, state.span);
            context.with(state.activeCtx, () => {
              if (isOchTraceDebugLogEnabled()) {
                const tpRaw = metadataGetter.get(metadata, "traceparent");
                const tp = Array.isArray(tpRaw) ? tpRaw[0] : tpRaw;
                logTraceDebug(process.env.OTEL_SERVICE_NAME?.trim() || "grpc", tp);
              }
              nextMeta(metadata);
            });
          },
          onReceiveMessage: (message, nextMsg) => {
            context.with(state.activeCtx, () => nextMsg(message));
          },
          onReceiveHalfClose: (nextHc) => {
            context.with(state.activeCtx, () => nextHc());
          },
          onCancel: () => {
            const s = state.span;
            if (s) {
              s.setStatus({ code: SpanStatusCode.ERROR, message: "cancelled" });
              s.end();
              state.span = undefined;
            }
          },
        });
      },
      sendStatus: (status, next) => {
        const s = state.span;
        if (s) {
          const durationMs =
            state.startHr === 0n ? 0 : Number(process.hrtime.bigint() - state.startHr) / 1e6;
          s.setAttributes({
            "rpc.grpc.status_code": status.code,
            "rpc.grpc.latency_ms": durationMs,
          });
          if (status.code !== grpc.status.OK) {
            s.setStatus({ code: SpanStatusCode.ERROR, message: status.details });
            s.setAttribute("net.error", `grpc_${status.code}`);
          }
          logGrpcServerInterceptorFinish({
            path: methodDescriptor.path,
            grpcStatusCode: status.code,
            latencyMs: durationMs,
            span: s,
          });
          s.end();
          state.span = undefined;
        }
        next(status);
      },
    });
  };
}
