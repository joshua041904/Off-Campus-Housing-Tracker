import { context, trace } from "@opentelemetry/api";

/** Opt-in noisy proof logging: `OCH_TRACE_DEBUG_LOG=1` (or `true` / `yes`). */
export function isOchTraceDebugLogEnabled(): boolean {
  const v = process.env.OCH_TRACE_DEBUG_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * One-line proof that the active OTEL span matches the inbound W3C carrier (k6-injected traceparent, etc.).
 * Safe to call once per request / RPC when {@link isOchTraceDebugLogEnabled} is on.
 */
export function logTraceDebug(service: string, incomingTraceparent: string | undefined): void {
  if (!isOchTraceDebugLogEnabled()) return;
  const span = trace.getSpan(context.active());
  const sc = span?.spanContext();
  const traceId = sc?.traceId && sc.traceId.length > 0 ? sc.traceId : "none";
  const sampled = sc?.traceFlags !== undefined ? String(sc.traceFlags) : "";
  console.log(
    `[TRACE] service=${service} otel_trace_id=${traceId} trace_flags=${sampled} incoming_traceparent=${incomingTraceparent ?? "none"}`,
  );
}
