/**
 * Service-wide transactional outbox observability (OCH).
 * Every HTTP service should call `initOchOutboxSurfaceMetrics` once at startup so Prometheus
 * always exposes `och_outbox_supported` (1 = implements outbox + gauges live, 0 = none).
 */
import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.js";

const serviceName = (): string =>
  (process.env.OTEL_SERVICE_NAME || "").trim() || "unknown-service";

const lbl = () => ({ service: serviceName() });

let supportedGauge: Gauge | undefined;
let unpublishedGauge: Gauge | undefined;
let oldestAgeGauge: Gauge | undefined;
let lastSuccessGauge: Gauge | undefined;
let publishAttempts: Counter | undefined;
let publishFailures: Counter | undefined;
let publishSuccess: Counter | undefined;

function ensureMetrics(): void {
  if (supportedGauge) return;
  supportedGauge = new Gauge({
    name: "och_outbox_supported",
    help: "1 if this service implements transactional outbox publishing; 0 if not.",
    labelNames: ["service"],
  });
  unpublishedGauge = new Gauge({
    name: "och_outbox_unpublished_count",
    help: "Unpublished outbox rows awaiting publish (0 when unsupported).",
    labelNames: ["service"],
  });
  oldestAgeGauge = new Gauge({
    name: "och_outbox_oldest_unpublished_age_seconds",
    help: "Age in seconds of oldest unpublished outbox row (0 when empty or unsupported).",
    labelNames: ["service"],
  });
  lastSuccessGauge = new Gauge({
    name: "och_outbox_last_success_timestamp_seconds",
    help: "Unix time of last successful outbox publish (0 if never).",
    labelNames: ["service"],
  });
  publishAttempts = new Counter({
    name: "och_outbox_publish_attempts_total",
    help: "Outbox publish attempts (Kafka send after claim).",
    labelNames: ["service"],
  });
  publishFailures = new Counter({
    name: "och_outbox_publish_failures_total",
    help: "Outbox publish failures after claim.",
    labelNames: ["service"],
  });
  publishSuccess = new Counter({
    name: "och_outbox_publish_success_total",
    help: "Outbox rows successfully published.",
    labelNames: ["service"],
  });
  register.registerMetric(supportedGauge);
  register.registerMetric(unpublishedGauge);
  register.registerMetric(oldestAgeGauge);
  register.registerMetric(lastSuccessGauge);
  register.registerMetric(publishAttempts);
  register.registerMetric(publishFailures);
  register.registerMetric(publishSuccess);
}

/** Services with no outbox table / publisher — still scraped with explicit zeros. */
export function initOchOutboxSurfaceUnsupported(): void {
  ensureMetrics();
  const s = lbl();
  supportedGauge!.set(s, 0);
  unpublishedGauge!.set(s, 0);
  oldestAgeGauge!.set(s, 0);
  lastSuccessGauge!.set(s, 0);
}

/** Auth / media style: transactional outbox is part of the service. */
export function initOchOutboxSurfaceSupported(): void {
  ensureMetrics();
  supportedGauge!.set(lbl(), 1);
  unpublishedGauge!.set(lbl(), 0);
  oldestAgeGauge!.set(lbl(), 0);
  lastSuccessGauge!.set(lbl(), 0);
}

export function setOchOutboxUnpublishedCount(n: number): void {
  ensureMetrics();
  unpublishedGauge!.set(lbl(), Number.isFinite(n) ? n : 0);
}

export function setOchOutboxOldestUnpublishedAgeSeconds(sec: number): void {
  ensureMetrics();
  oldestAgeGauge!.set(lbl(), Number.isFinite(sec) && sec > 0 ? sec : 0);
}

export function incOchOutboxPublishAttempt(): void {
  ensureMetrics();
  publishAttempts!.inc(lbl());
}

export function incOchOutboxPublishFailure(): void {
  ensureMetrics();
  publishFailures!.inc(lbl());
}

export function incOchOutboxPublishSuccess(): void {
  ensureMetrics();
  publishSuccess!.inc(lbl());
  lastSuccessGauge!.set(lbl(), Math.floor(Date.now() / 1000));
}
