import type { Express, Request, Response } from "express";
import type { Context } from "@opentelemetry/api";
import { context, SpanStatusCode, trace, TraceFlags } from "@opentelemetry/api";
import client from "prom-client";
import { register } from "@common/utils";
import { getIncomingHttpOtelContext, tracedFetch } from "@common/utils/otel";

export type FullTraceBases = {
  authHttp: string;
  listingsHttp: string;
  trustHttp: string;
  bookingHttp: string;
  messagingHttp: string;
  mediaHttp: string;
  notificationHttp: string;
  analyticsHttp: string;
};

type TraceStep = { key: string; url: string };

type IncomingTraceHeaders = {
  traceparent?: string;
  tracestate?: string;
};

export type FullTraceStepResult = {
  key: string;
  /** e.g. auth-service — matches housing service naming */
  service: string;
  url: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  attempts: number;
  error?: string;
  slow?: boolean;
};

const TRACE_HISTOGRAM = "trace_service_latency_ms";

function traceServiceLatencyHistogram(): client.Histogram<"service" | "status"> {
  const existing = register.getSingleMetric(TRACE_HISTOGRAM) as client.Histogram<"service" | "status"> | undefined;
  if (existing) return existing;
  return new client.Histogram({
    name: TRACE_HISTOGRAM,
    help: "Wall time per downstream hop in GET /api/debug/full-trace (ms), including retries",
    labelNames: ["service", "status"],
    buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000],
    registers: [register],
    enableExemplars: true,
  });
}

function traceExemplarLabels(): Record<string, string> | undefined {
  const sc = trace.getActiveSpan()?.spanContext();
  if (!sc?.traceId || sc.traceId === "00000000000000000000000000000000") return undefined;
  if ((sc.traceFlags & TraceFlags.SAMPLED) !== TraceFlags.SAMPLED) return undefined;
  return { trace_id: sc.traceId };
}

type HistogramExemplar = {
  observeWithExemplar(o: {
    labels: { service: string; status: string };
    value: number;
    exemplarLabels: Record<string, string>;
  }): void;
  observe(labels: { service: string; status: string }, value: number): void;
};

function observeTraceServiceLatency(labels: { service: string; status: string }, value: number): void {
  const h = traceServiceLatencyHistogram() as unknown as HistogramExemplar;
  const ex = traceExemplarLabels();
  if (ex) {
    h.observeWithExemplar({ labels, value, exemplarLabels: ex });
    return;
  }
  h.observe(labels, value);
}

function buildSteps(bases: FullTraceBases): TraceStep[] {
  const n = (u: string) => u.replace(/\/$/, "");
  // One lightweight traced GET per service (not healthz-only): proves cross-service graph + W3C propagation.
  const h = "/debug/headers";
  return [
    { key: "auth", url: `${n(bases.authHttp)}${h}` },
    { key: "listings", url: `${n(bases.listingsHttp)}${h}` },
    { key: "trust", url: `${n(bases.trustHttp)}${h}` },
    { key: "booking", url: `${n(bases.bookingHttp)}${h}` },
    { key: "messaging", url: `${n(bases.messagingHttp)}${h}` },
    { key: "media", url: `${n(bases.mediaHttp)}${h}` },
    { key: "notification", url: `${n(bases.notificationHttp)}${h}` },
    { key: "analytics", url: `${n(bases.analyticsHttp)}${h}` },
  ];
}

function parseTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FULL_TRACE_TIMEOUT_MS ?? "3000", 10);
  if (!Number.isFinite(raw) || raw < 1) return 3000;
  return Math.min(raw, 120_000);
}

function isTimeoutLike(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || err.name === "TimeoutError";
}

async function executeDownstreamStep(
  hopCtx: Context,
  incomingTraceHeaders: IncomingTraceHeaders,
  key: string,
  url: string,
  timeoutMs: number,
): Promise<FullTraceStepResult> {
  const service = `${key}-service`;
  const wall0 = Date.now();
  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    const t0 = Date.now();
    try {
      const res = await tracedFetch(url, {
        propagationContext: hopCtx,
        headers: {
          "x-debug-replay": "full-trace",
          "x-och-edge-proto": "h3",
          ...(incomingTraceHeaders.traceparent ? { traceparent: incomingTraceHeaders.traceparent } : {}),
          ...(incomingTraceHeaders.tracestate ? { tracestate: incomingTraceHeaders.tracestate } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const attemptMs = Date.now() - t0;
      lastStatus = res.status;
      console.log("full-trace call", { service, url, status: res.status, latencyMs: attemptMs, attempt });

      if (res.ok) {
        const totalMs = Date.now() - wall0;
        observeTraceServiceLatency({ service, status: String(res.status) }, totalMs);
        return {
          key,
          service,
          url,
          ok: true,
          status: res.status,
          latencyMs: totalMs,
          attempts,
          slow: totalMs > 1000,
        };
      }

      lastError = `HTTP ${res.status}`;
      console.error("full-trace non-2xx", { service, url, status: res.status, attempt });

      if (attempt === 2) {
        const totalMs = Date.now() - wall0;
        observeTraceServiceLatency({ service, status: String(res.status) }, totalMs);
        return {
          key,
          service,
          url,
          ok: false,
          status: res.status,
          latencyMs: totalMs,
          attempts,
          error: lastError,
          slow: totalMs > 1000,
        };
      }
    } catch (err) {
      const attemptMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const timedOut = isTimeoutLike(err);
      lastError = timedOut ? "timeout" : msg;
      console.error("full-trace error", { service, url, err: msg, attempt, latencyMs: attemptMs, timedOut });

      if (attempt === 2) {
        const totalMs = Date.now() - wall0;
        observeTraceServiceLatency({ service, status: timedOut ? "timeout" : "error" }, totalMs);
        return {
          key,
          service,
          url,
          ok: false,
          latencyMs: totalMs,
          attempts,
          error: lastError,
          slow: totalMs > 1000,
        };
      }
    }
  }

  const totalMs = Date.now() - wall0;
  observeTraceServiceLatency({ service, status: "unexpected_failure" }, totalMs);
  return {
    key,
    service,
    url,
    ok: false,
    status: lastStatus,
    latencyMs: totalMs,
    attempts,
    error: lastError ?? "unexpected_failure",
    slow: totalMs > 1000,
  };
}

async function runStepWithSpan(
  parentCtx: Context,
  incomingTraceHeaders: IncomingTraceHeaders,
  tracer: ReturnType<typeof trace.getTracer>,
  step: TraceStep,
  timeoutMs: number,
): Promise<FullTraceStepResult> {
  const { key, url } = step;
  const span = tracer.startSpan(`full_trace.${key}`, {}, parentCtx);
  span.setAttribute("trace.coverage", "full");
  const ctx = trace.setSpan(parentCtx, span);
  const outerT0 = Date.now();
  try {
    return await context.with(ctx, async () => {
      const row = await executeDownstreamStep(ctx, incomingTraceHeaders, key, url, timeoutMs);
      if (typeof row.status === "number") {
        span.setAttribute("http.status_code", row.status);
      }
      if (row.ok) {
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: row.error ?? (row.status ? `HTTP ${row.status}` : "downstream_error"),
        });
      }
      return row;
    });
  } catch (e) {
    span.recordException(e instanceof Error ? e : new Error(String(e)));
    span.setStatus({ code: SpanStatusCode.ERROR });
    const latencyMs = Date.now() - outerT0;
    observeTraceServiceLatency({ service: `${key}-service`, status: "unexpected_failure" }, latencyMs);
    return {
      key,
      service: `${key}-service`,
      url,
      ok: false,
      latencyMs,
      attempts: 0,
      error: "unexpected_failure",
      slow: latencyMs > 1000,
    };
  } finally {
    span.setAttribute("full_trace.step_ms", Date.now() - outerT0);
    span.end();
  }
}

/**
 * Deterministic multi-hop trace for Step7 / contract tests: nested client spans so Jaeger depth ≥ 3,
 * then fan-out to every housing HTTP service with propagated W3C context.
 *
 * Always responds HTTP 200 so edge/Caddy never maps a partial downstream outage to 502; see JSON `ok`
 * and `services` / `steps` for per-hop health.
 */
export function mountFullTraceDebug(app: Express, bases: FullTraceBases): void {
  const timeoutMs = parseTimeoutMs();
  const handler = async (req: Request, res: Response) => {
    // Capture parent Context synchronously (before any await). Express async handlers drop ALS.
    const parentCtx = getIncomingHttpOtelContext(req) ?? context.active();
    // Preserve seeded contract trace id from edge and forward explicitly on every downstream hop.
    const incomingTraceHeaders: IncomingTraceHeaders = {
      traceparent: req.get("traceparent") ?? undefined,
      tracestate: req.get("tracestate") ?? undefined,
    };

    const root = trace.getActiveSpan();
    root?.setAttribute("trace.coverage", "full");

    const tracer = trace.getTracer("api-gateway-full-trace");
    const steps = buildSteps(bases);

    const settled = await Promise.allSettled(
      steps.map((step) => runStepWithSpan(parentCtx, incomingTraceHeaders, tracer, step, timeoutMs)),
    );

    const services: FullTraceStepResult[] = settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      const step = steps[i]!;
      return {
        key: step.key,
        service: `${step.key}-service`,
        url: step.url,
        ok: false,
        latencyMs: 0,
        attempts: 0,
        error: "unexpected_failure",
      };
    });

    const stepsMap: Record<string, number> = {};
    for (const row of services) {
      stepsMap[row.key] = typeof row.status === "number" ? row.status : 0;
    }

    const ok = services.every((r) => r.ok);
    const success = services.filter((r) => r.ok).length;
    const failed = services.length - success;

    res.status(200).json({
      ok,
      trace: "full",
      total: services.length,
      success,
      failed,
      steps: stepsMap,
      services,
    });
  };

  app.get(["/api/debug/full-trace", "/debug/full-trace"], handler);
}
