/**
 * Golden-path OpenTelemetry Node SDK (Jaeger / OTLP HTTP, resource, auto-instrumentation toggles).
 * Team guide: docs/tracing-booking-flow.md
 */
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type Sampler,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { EnsureNetProtoSpanProcessor } from "./ensure-net-proto-span-processor.js";

export type StartNodeTelemetryOptions = {
  serviceName: string;
};

/** In-cluster Jaeger Service (see infra/k8s/base/observability/jaeger-deploy.yaml). */
export const DEFAULT_K8S_JAEGER_OTLP_HTTP_BASE = "http://jaeger.observability.svc.cluster.local:4318";

function defaultInClusterJaegerTracesUrl(): string | undefined {
  if (process.env.OCH_OTEL_DISABLE_CLUSTER_JAEGER === "1" || process.env.OCH_OTEL_DISABLE_CLUSTER_JAEGER === "true") {
    return undefined;
  }
  if (!process.env.KUBERNETES_SERVICE_HOST) return undefined;
  return `${DEFAULT_K8S_JAEGER_OTLP_HTTP_BASE.replace(/\/$/, "")}/v1/traces`;
}

/** MetalLB IP or hostname reachable from the process (no scheme). */
function otlpTracesUrlFromOchJaegerHost(): string | undefined {
  const host = process.env.OCH_JAEGER_OTLP_HOST?.trim();
  if (!host) return undefined;
  if (host.startsWith("http://") || host.startsWith("https://")) {
    const normalized = host.replace(/\/$/, "");
    return normalized.endsWith("/v1/traces") ? normalized : `${normalized}/v1/traces`;
  }
  return `http://${host}:4318/v1/traces`;
}

function allowsLocalhostOtlp(): boolean {
  return (
    process.env.OCH_OTEL_LOCAL_JAEGER === "1" ||
    process.env.OCH_OTEL_LOCAL_JAEGER === "true" ||
    process.env.NODE_ENV === "test"
  );
}

function urlLooksLikeForbiddenLocalhostOtlp(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v.includes("localhost") ||
    v.includes("127.0.0.1") ||
    v.includes("[::1]") ||
    v.includes("0.0.0.0")
  );
}

/**
 * Reject OTLP URLs pointing at loopback unless {@link allowsLocalhostOtlp} (docker-compose / unit tests).
 * Call after resolving the final `/v1/traces` URL.
 */
export function assertNoForbiddenLocalhostOtlpUrl(url: string | undefined): void {
  if (!url || allowsLocalhostOtlp()) return;
  if (urlLooksLikeForbiddenLocalhostOtlp(url)) {
    throw new Error(
      "[otel] OTLP traces URL must not use localhost / 127.0.0.1 unless OCH_OTEL_LOCAL_JAEGER=1. Use in-cluster Jaeger DNS, MetalLB (OCH_JAEGER_OTLP_HOST), or explicit non-loopback OTEL_EXPORTER_OTLP_*.",
    );
  }
}

/**
 * Reject user-supplied OTLP env vars that point at loopback (catches misconfiguration before resolution).
 */
export function assertNoForbiddenLocalhostOtlpEnv(): void {
  if (allowsLocalhostOtlp()) return;

  const check = (name: string, raw: string | undefined) => {
    const v = raw?.trim();
    if (!v) return;
    if (urlLooksLikeForbiddenLocalhostOtlp(v)) {
      throw new Error(
        `[otel] ${name} must not use localhost / 127.0.0.1 unless OCH_OTEL_LOCAL_JAEGER=1 (MetalLB or cluster DNS only).`,
      );
    }
  };

  check("OTEL_EXPORTER_OTLP_ENDPOINT", process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  check("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  check("OCH_OTEL_EXPORTER_OTLP_ENDPOINT", process.env.OCH_OTEL_EXPORTER_OTLP_ENDPOINT);
  check("OCH_JAEGER_OTLP_HOST", process.env.OCH_JAEGER_OTLP_HOST);
}

/** Explicit docker-compose / laptop Jaeger (opt-in; not used in cluster). */
function defaultLocalJaegerOtlpTracesUrl(): string | undefined {
  if (process.env.OCH_OTEL_LOCAL_JAEGER !== "1" && process.env.OCH_OTEL_LOCAL_JAEGER !== "true") {
    return undefined;
  }
  if (process.env.CI === "true" || process.env.CI === "1") return undefined;
  if (process.env.NODE_ENV === "test") return undefined;
  return "http://127.0.0.1:4318/v1/traces";
}

function resolveOtlpTracesUrl(): string | undefined {
  const direct = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (direct) return direct;
  const base =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || process.env.OCH_OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (base) {
    const normalized = base.replace(/\/$/, "");
    if (normalized.endsWith("/v1/traces")) return normalized;
    return `${normalized}/v1/traces`;
  }
  const cluster = defaultInClusterJaegerTracesUrl();
  if (cluster) return cluster;
  const metallb = otlpTracesUrlFromOchJaegerHost();
  if (metallb) return metallb;
  return defaultLocalJaegerOtlpTracesUrl();
}

function shouldUseOtlp(tracesUrl: string | undefined): boolean {
  if (process.env.OTEL_TRACES_EXPORTER?.trim().toLowerCase() === "console") return false;
  return Boolean(tracesUrl);
}

const propagator = new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
});

/**
 * BOOTSTRAP_TRACE=1 — force AlwaysOnSampler (deterministic bootstrap / contract traces).
 * RUNTIME_HIGH_LOAD=1 — when OTEL_TRACES_SAMPLER is unset, use a capped trace-id ratio (see OTEL_TRACE_RATIO).
 * OTEL_TRACES_SAMPLER: always_on | always_off | traceidratio | parentbased_always_on |
 * parentbased_always_off | parentbased_traceidratio (default: parentbased_always_on).
 * OTEL_TRACES_SAMPLER_ARG: ratio for *traceidratio variants (0–1).
 */
function buildSamplerFromEnv(): Sampler {
  if (process.env.BOOTSTRAP_TRACE === "1" || process.env.BOOTSTRAP_TRACE === "true") {
    return new AlwaysOnSampler();
  }

  const raw = (process.env.OTEL_TRACES_SAMPLER || "").trim().toLowerCase();
  // Only when sampler is not configured explicitly (pods usually set OTEL_TRACES_SAMPLER via app-config).
  if (
    !raw &&
    (process.env.RUNTIME_HIGH_LOAD === "1" || process.env.RUNTIME_HIGH_LOAD === "true")
  ) {
    const baseRatio = Number(process.env.OTEL_TRACE_RATIO?.trim() || process.env.OTEL_TRACES_SAMPLER_ARG?.trim() || "0.2");
    const r = Math.min(Number.isFinite(baseRatio) ? baseRatio : 0.2, 0.05);
    return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(r) });
  }

  const arg = process.env.OTEL_TRACES_SAMPLER_ARG?.trim();
  const ratio = () => {
    const n = Number(arg ?? "1");
    if (!Number.isFinite(n)) return 1;
    return Math.min(1, Math.max(0, n));
  };

  if (!raw || raw === "parentbased_always_on") {
    return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  }
  if (raw === "always_on") return new AlwaysOnSampler();
  if (raw === "always_off") return new AlwaysOffSampler();
  if (raw === "traceidratio") return new TraceIdRatioBasedSampler(ratio());
  if (raw === "parentbased_always_off") {
    return new ParentBasedSampler({ root: new AlwaysOffSampler() });
  }
  if (raw === "parentbased_traceidratio") {
    return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio()) });
  }
  return new ParentBasedSampler({ root: new AlwaysOnSampler() });
}

let sdk: NodeSDK | undefined;
let shutdownHookRegistered = false;

function registerTracingShutdownHook(): void {
  if (shutdownHookRegistered || !sdk) return;
  shutdownHookRegistered = true;
  const flush = () => {
    void sdk?.shutdown().catch((e) => console.error("[otel] shutdown error:", e));
  };
  process.once("SIGTERM", flush);
  process.once("SIGINT", flush);
}

/**
 * Golden-path: same as {@link startNodeTelemetry}. Prefer `import "./otel-bootstrap.js"` as the first
 * import in the service entry so the SDK starts before frameworks load. `OTEL_SERVICE_NAME` overrides
 * the default name passed here.
 */
export function initTracing(serviceName: string): void {
  startNodeTelemetry({ serviceName });
}

/**
 * Same idea as a standalone `src/otel.ts` `startTracing()` entrypoint: async so callers can
 * `await startTracing()` before listening (preload/bootstrap here calls {@link startNodeTelemetry}).
 */
export async function startTracing(options: StartNodeTelemetryOptions): Promise<void> {
  startNodeTelemetry(options);
}

/**
 * Initialize the OpenTelemetry Node SDK. Call from a tiny preload/bootstrap file
 * so it runs before `express` / `@grpc/grpc-js` are first loaded.
 */
export function startNodeTelemetry(options: StartNodeTelemetryOptions): void {
  if (process.env.OTEL_SDK_DISABLED === "true" || process.env.OTEL_SDK_DISABLED === "1") {
    return;
  }

  if (sdk) {
    return;
  }

  assertNoForbiddenLocalhostOtlpEnv();

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || options.serviceName;

  const resource = new Resource({
    "service.version": process.env.SERVICE_VERSION?.trim() || "0.0.0",
  });

  const tracesUrl = resolveOtlpTracesUrl();
  const useOtlp = shouldUseOtlp(tracesUrl);
  if (useOtlp) {
    assertNoForbiddenLocalhostOtlpUrl(tracesUrl);
  }

  const exportProcessor = useOtlp
    ? new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: tracesUrl,
        }),
      )
    : new SimpleSpanProcessor(new ConsoleSpanExporter());
  const ensureNetProto = new EnsureNetProtoSpanProcessor();

  sdk = new NodeSDK({
    serviceName,
    resource,
    contextManager: new AsyncLocalStorageContextManager(),
    sampler: buildSamplerFromEnv(),
    spanProcessors: [ensureNetProto, exportProcessor],
    textMapPropagator: propagator,
    // Template parity with `getNodeAutoInstrumentations()`; http/express/grpc off so we do not
    // double-span alongside manual Express + grpc-js interceptors.
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": { enabled: false },
        "@opentelemetry/instrumentation-express": { enabled: false },
        "@opentelemetry/instrumentation-grpc": { enabled: false },
        // Undici patches global `fetch` and can re-inject W3C headers from a different active context than
        // our explicit `tracedFetch` / gateway hops — breaks trace-contract (Jaeger shows only api-gateway).
        "@opentelemetry/instrumentation-undici": { enabled: false },
      }),
    ],
    autoDetectResources: true,
  });

  sdk.start();
  registerTracingShutdownHook();
  console.log("OpenTelemetry initialized");
  if (useOtlp) {
    console.log("Tracing → Jaeger / OTLP collector (OTLP HTTP)");
  }
  console.log(`[otel] service=${serviceName} traces=${useOtlp ? "otlp" : "console"}`);
}
