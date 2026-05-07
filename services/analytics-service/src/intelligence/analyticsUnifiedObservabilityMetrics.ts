import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import client from "prom-client";
import { register } from "@common/utils";

const secBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

/** Canonical names for Grafana / SLO dashboards (alongside legacy analytics_generation_* metrics). */
export const analyticsRequestsTotal = new client.Counter({
  name: "analytics_requests_total",
  help: "Listing analyze / listing-feel AI requests (HTTP or gRPC) completed",
  labelNames: ["route", "status"] as const,
  registers: [register],
});

export const analyticsLatencySeconds = new client.Histogram({
  name: "analytics_latency_seconds",
  help: "End-to-end analyze latency (seconds)",
  buckets: secBuckets,
  labelNames: ["route"] as const,
  registers: [register],
});

export const analyticsFallbackTotal = new client.Counter({
  name: "analytics_fallback_total",
  help: "AI path used rule-based / none / explicit fallback",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const analyticsHallucinationTotal = new client.Counter({
  name: "analytics_hallucination_total",
  help: "Reserved: increment when hallucination detector flags output (QA wiring)",
  registers: [register],
});

export const analyticsTokensGeneratedTotal = new client.Counter({
  name: "analytics_tokens_generated_total",
  help: "Estimated output-side tokens (best-effort from generation meta)",
  registers: [register],
});

export const analyticsEntropyValue = new client.Gauge({
  name: "analytics_entropy_value",
  help: "Last observed verdict entropy (0–1) for listing intelligence",
  registers: [register],
});

export const analyticsConfidenceScore = new client.Gauge({
  name: "analytics_confidence_score",
  help: "Last observed calibrated confidence (0–100)",
  registers: [register],
});

export const kafkaSkewMaxShare = new client.Gauge({
  name: "kafka_skew_max_share",
  help: "Latest partition skew max_share from coverage-kafka-skew.json or telemetry ingest",
  registers: [register],
});

export const kafkaSkewPass = new client.Gauge({
  name: "kafka_skew_pass",
  help: "1 if latest skew verification passed else 0",
  registers: [register],
});

export const qaSuiteDurationSeconds = new client.Histogram({
  name: "qa_suite_duration_seconds",
  help: "Analytics QA suite wall-clock duration (seconds) when pushed via /internal/telemetry",
  buckets: [5, 30, 60, 120, 300, 600, 1200, 2400, 3600],
  registers: [register],
});

export const analyticsQualityLowTotal = new client.Counter({
  name: "analytics_quality_low_total",
  help: "Analyze responses flagged low quality (short text, numeric conflict, or low entropy in variable mode)",
  labelNames: ["reason"] as const,
  registers: [register],
});

export const analyticsQualityScore = new client.Gauge({
  name: "analytics_quality_score",
  help: "0–100 heuristic quality score for the last completed analyze/listing-feel response",
  registers: [register],
});

export type AnalysisQualityGateInput = {
  analysisTextLen: number;
  entropy?: number;
  numericConflict: boolean;
  /** When true, low entropy contributes to low-quality scoring (QA variability harness). */
  variableEntropyMode?: boolean;
};

/** Heuristic SLO-oriented score; increments analytics_quality_low_total when quality is clearly weak. */
export function recordAnalysisQualityGate(input: AnalysisQualityGateInput): { score: number; low: boolean; reasons: string[] } {
  let score = 72;
  const reasons: string[] = [];
  if (input.analysisTextLen < 480) {
    score -= 22;
    reasons.push("short");
  }
  if (input.numericConflict) {
    score -= 38;
    reasons.push("numeric_conflict");
  }
  if (input.variableEntropyMode && input.entropy != null && Number.isFinite(input.entropy) && input.entropy < 0.2) {
    score -= 18;
    reasons.push("entropy_low");
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  analyticsQualityScore.set(score);
  const low = score < 52 || reasons.length >= 2;
  if (low) {
    analyticsQualityLowTotal.inc({ reason: reasons.length ? reasons.join("+") : "unspecified" });
  }
  return { score, low, reasons };
}

export type AnalyzeTelemetryInput = {
  route: string;
  httpStatus: number;
  latencyMs: number;
  modelUsed: string;
  temperature: number;
  tokensInput?: number;
  tokensOutput?: number;
  fallback: boolean;
  entropy?: number;
  confidence?: number;
};

export function recordAnalyzeTelemetry(input: AnalyzeTelemetryInput): void {
  const status = String(input.httpStatus);
  analyticsRequestsTotal.inc({ route: input.route, status });
  analyticsLatencySeconds.observe({ route: input.route }, input.latencyMs / 1000);
  if (input.fallback) {
    analyticsFallbackTotal.inc({ reason: input.modelUsed || "unknown" });
  }
  if (input.tokensOutput != null && Number.isFinite(input.tokensOutput)) {
    analyticsTokensGeneratedTotal.inc(input.tokensOutput);
  }
  if (input.entropy != null && Number.isFinite(input.entropy)) {
    analyticsEntropyValue.set(input.entropy);
  }
  if (input.confidence != null && Number.isFinite(input.confidence)) {
    analyticsConfidenceScore.set(input.confidence);
  }
}

export function recordTelemetryIngest(body: Record<string, unknown>): void {
  const qa = body.qa_suite_duration_seconds;
  if (typeof qa === "number" && Number.isFinite(qa)) {
    qaSuiteDurationSeconds.observe(qa);
  }
  const skew = body.kafka_skew_max_share;
  if (typeof skew === "number" && Number.isFinite(skew)) {
    kafkaSkewMaxShare.set(skew);
  }
  const pass = body.kafka_skew_pass;
  if (typeof pass === "boolean") {
    kafkaSkewPass.set(pass ? 1 : 0);
  }
}

/** Best-effort: read repo bench_logs skew JSON (host dev) when OCH_COVERAGE_KAFKA_SKEW_JSON is set. */
export function refreshKafkaSkewGaugesFromFile(): void {
  const p = process.env.OCH_COVERAGE_KAFKA_SKEW_JSON?.trim();
  if (!p || !existsSync(p)) return;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { pass?: boolean; max_partition_share?: number };
    if (typeof j.max_partition_share === "number" && Number.isFinite(j.max_partition_share)) {
      kafkaSkewMaxShare.set(j.max_partition_share);
    }
    if (typeof j.pass === "boolean") {
      kafkaSkewPass.set(j.pass ? 1 : 0);
    }
  } catch {
    /* ignore */
  }
}

const __dir = dirname(fileURLToPath(import.meta.url));
const defaultSkewPath = join(__dir, "..", "..", "..", "..", "bench_logs", "coverage-kafka-skew.json");

export function startSkewGaugePoller(): void {
  const intervalMs = Number(process.env.OCH_KAFKA_SKEW_GAUGE_POLL_MS || "20000");
  if (!Number.isFinite(intervalMs) || intervalMs < 5000) return;
  const path = process.env.OCH_COVERAGE_KAFKA_SKEW_JSON?.trim() || defaultSkewPath;
  if (!existsSync(path)) return;
  process.env.OCH_COVERAGE_KAFKA_SKEW_JSON = path;
  setInterval(() => refreshKafkaSkewGaugesFromFile(), intervalMs).unref?.();
}
