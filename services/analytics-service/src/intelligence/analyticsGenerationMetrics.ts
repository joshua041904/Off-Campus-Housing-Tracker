import client from "prom-client";
import { register } from "@common/utils";

// End with +Inf so values above the largest finite bucket do not break internal bucket accounting.
const bucketsLatency = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 3500, 5000, 10000, 60000, 120000, 300000, 600000, Number.POSITIVE_INFINITY,
];

export const analyticsGenerationLatencyMs = new client.Histogram({
  name: "analytics_generation_latency_ms",
  help: "End-to-end listing intelligence generation latency (ms)",
  buckets: bucketsLatency,
  registers: [register],
  labelNames: ["path"] as const,
});

export const analyticsGenerationTokensEstimated = new client.Histogram({
  name: "analytics_generation_tokens_estimated",
  help: "Rough prompt+system token estimate (chars/4)",
  buckets: [128, 256, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, Number.POSITIVE_INFINITY],
  registers: [register],
});

export const analyticsGenerationTruncatedTotal = new client.Counter({
  name: "analytics_generation_truncated_total",
  help: "Listing descriptions truncated before model call",
  registers: [register],
});

export const analyticsGenerationFallbackTotal = new client.Counter({
  name: "analytics_generation_fallback_total",
  help: "Listing-feel / intelligence fell back to non-LLM path",
  registers: [register],
  labelNames: ["reason"] as const,
});

/** One increment per model-backed generation attempt (v2 entry or legacy listing-feel Ollama call). */
export const analyticsGenerationRequestsTotal = new client.Counter({
  name: "analytics_generation_requests_total",
  help: "Listing intelligence / listing-feel generation attempts (denominator for fallback ratio)",
  registers: [register],
  labelNames: ["path"] as const,
});

/** Calibrated confidence_score (0–100) after merge; observe on successful v2 only. */
export const analyticsGenerationConfidence = new client.Histogram({
  name: "analytics_generation_confidence",
  help: "Listing intelligence v2 calibrated confidence score (0-100)",
  buckets: [0, 25, 40, 50, 60, 65, 70, 75, 80, 85, 90, 92, 95, 100],
  registers: [register],
});

export const analyticsGenerationEntropy = new client.Histogram({
  name: "analytics_generation_entropy",
  help: "Observed verdict entropy from QA harness (optional scrape)",
  buckets: [0, 0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 1],
  registers: [register],
});

/** Single repair /api/generate after strict schema validation failed on first JSON (v2). */
export const analyticsLiV2SchemaRepairTotal = new client.Counter({
  name: "analytics_li_v2_schema_repair_total",
  help: "Listing intelligence v2: strict validation failed once; one SCHEMA_REPAIR Ollama call was attempted",
  registers: [register],
});

/** POST /insights/listing-feel entered HTTP catch (analyzeListingFeelText threw). Label `code` from classifyListingFeelHttpFailure. */
export const analyticsListingFeelCatchTotal = new client.Counter({
  name: "analytics_listing_feel_catch_total",
  help: "Listing-feel handler catch: typed failure before soft-degraded or hard-fail response",
  labelNames: ["code"] as const,
  registers: [register],
});

/** Ollama /api/generate aborted by unified timeout (v2 generate or schema repair). */
export const analyticsOllamaTimeoutTotal = new client.Counter({
  name: "analytics_ollama_timeout_total",
  help: "Ollama generate aborted due to timeout (AbortSignal / controller)",
  labelNames: ["stage"] as const,
  registers: [register],
});

const bucketsGenDuration = [
  50, 100, 250, 500, 1000, 2000, 3500, 5000, 8000, 15000, 30000, 60000, 120000, 300000, 600000,
  Number.POSITIVE_INFINITY,
];

/** Wall-clock duration for a successful listing intelligence v2 run (end-to-end). */
export const analyticsGenerationDurationMs = new client.Histogram({
  name: "analytics_generation_duration_ms",
  help: "Listing intelligence v2 wall duration (ms) on success",
  buckets: bucketsGenDuration,
  registers: [register],
  labelNames: ["depth"] as const,
});

/** num_predict budget passed to Ollama for the primary v2 generation path. */
export const analyticsGenerationPredictTokens = new client.Histogram({
  name: "analytics_generation_predict_tokens",
  help: "Ollama num_predict used for listing intelligence v2 (success path)",
  buckets: [64, 128, 200, 300, 400, 560, 700, 800, 1000, 1500],
  registers: [register],
  labelNames: ["depth"] as const,
});

function safeRegisterMetric(m: Parameters<(typeof register)["registerMetric"]>[0]): void {
  try {
    register.registerMetric(m);
  } catch {
    /* duplicate registration in tests */
  }
}
safeRegisterMetric(analyticsGenerationLatencyMs);
safeRegisterMetric(analyticsGenerationTokensEstimated);
safeRegisterMetric(analyticsGenerationTruncatedTotal);
safeRegisterMetric(analyticsGenerationFallbackTotal);
safeRegisterMetric(analyticsGenerationRequestsTotal);
safeRegisterMetric(analyticsGenerationConfidence);
safeRegisterMetric(analyticsGenerationEntropy);
safeRegisterMetric(analyticsLiV2SchemaRepairTotal);
safeRegisterMetric(analyticsListingFeelCatchTotal);
safeRegisterMetric(analyticsOllamaTimeoutTotal);
safeRegisterMetric(analyticsGenerationDurationMs);
safeRegisterMetric(analyticsGenerationPredictTokens);
