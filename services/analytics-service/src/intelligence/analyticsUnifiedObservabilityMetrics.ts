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

export const analyticsControlPlaneMode = new client.Gauge({
  name: "analytics_control_plane_mode",
  help: "Control-plane runtime mode (0=normal, 1=degraded, 2=legacy)",
  registers: [register],
});

export const analyticsControlPlaneActionsTotal = new client.Counter({
  name: "analytics_control_plane_actions_total",
  help: "Total control-plane actions applied by action type",
  labelNames: ["action"] as const,
  registers: [register],
});

export const analyticsModelQualityScore = new client.Gauge({
  name: "analytics_model_quality_score",
  help: "Rolling model quality score (0-100) per model",
  labelNames: ["model"] as const,
  registers: [register],
});

export const analyticsModelReliabilityScore = new client.Gauge({
  name: "analytics_model_reliability_score",
  help: "Rolling model reliability score (0-100) from fallback behavior",
  labelNames: ["model"] as const,
  registers: [register],
});

export const analyticsModelLatencyMs = new client.Gauge({
  name: "analytics_model_latency_ms",
  help: "Rolling model latency estimate (ms) per model",
  labelNames: ["model"] as const,
  registers: [register],
});

export const analyticsModelCostPerReq = new client.Gauge({
  name: "analytics_model_cost_per_req",
  help: "Estimated cost per request for a model (USD, static policy value)",
  labelNames: ["model"] as const,
  registers: [register],
});

export const analyticsEmbeddingDriftScore = new client.Gauge({
  name: "analytics_embedding_drift_score",
  help: "Proxy embedding drift score (0-1) from rolling quality/entropy divergence",
  registers: [register],
});

export const analyticsPromptQualityScore = new client.Gauge({
  name: "analytics_prompt_quality_score",
  help: "Rolling quality score per prompt version (0-100)",
  labelNames: ["version"] as const,
  registers: [register],
});

export const analyticsPromptRequestsTotal = new client.Counter({
  name: "analytics_prompt_requests_total",
  help: "Total analyzed requests attributed to prompt version",
  labelNames: ["version"] as const,
  registers: [register],
});

export const analyticsPromptQualityCurrent = new client.Gauge({
  name: "analytics_prompt_quality_current",
  help: "Rolling quality score (0-100) for ANALYTICS_PROMPT_VERSION",
  registers: [register],
});

export const analyticsPromptQualityPrevious = new client.Gauge({
  name: "analytics_prompt_quality_previous",
  help: "Rolling quality score (0-100) for ANALYTICS_PROMPT_PREVIOUS_VERSION",
  registers: [register],
});

export const analyticsPromptCurrentRequestsTotal = new client.Counter({
  name: "analytics_prompt_current_requests_total",
  help: "Request count for current prompt version",
  registers: [register],
});

export const analyticsPromptPreviousRequestsTotal = new client.Counter({
  name: "analytics_prompt_previous_requests_total",
  help: "Request count for previous prompt version",
  registers: [register],
});

export const analyticsModelArbitrationRunsTotal = new client.Counter({
  name: "analytics_model_arbitration_runs_total",
  help: "Total arbitration comparisons between primary/canary outputs",
  labelNames: ["mode"] as const,
  registers: [register],
});

export const analyticsModelWinsTotal = new client.Counter({
  name: "analytics_model_wins_total",
  help: "Total arbitration wins by model",
  labelNames: ["model", "mode"] as const,
  registers: [register],
});

export const analyticsModelArbitrationDisagreementRatio = new client.Gauge({
  name: "analytics_model_arbitration_disagreement_ratio",
  help: "Last observed disagreement ratio between top two model scores",
  registers: [register],
});

export const aiClusterHealthScore = new client.Gauge({
  name: "ai_cluster_health_score",
  help: "Cluster-local AI health score (0-100) for active-active routing",
  labelNames: ["cluster"] as const,
  registers: [register],
});

type RunningModelStats = {
  requests: number;
  fallback: number;
  latencyMsSum: number;
  qualityScoreSum: number;
};

type RunningPromptStats = {
  requests: number;
  qualityScoreSum: number;
};

type RuntimeSnapshot = {
  totalRequests: number;
  fallbackRequests: number;
  latencyMsSum: number;
  qualityScoreSum: number;
  lastQualityScore: number;
  lastUpdatedAt: number;
  byModel: Record<string, RunningModelStats>;
  byPromptVersion: Record<string, RunningPromptStats>;
};

const runtimeSnapshot: RuntimeSnapshot = {
  totalRequests: 0,
  fallbackRequests: 0,
  latencyMsSum: 0,
  qualityScoreSum: 0,
  lastQualityScore: 0,
  lastUpdatedAt: Date.now(),
  byModel: {},
  byPromptVersion: {},
};

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
  qualityScore?: number;
  promptVersion?: string;
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
  runtimeSnapshot.totalRequests += 1;
  runtimeSnapshot.latencyMsSum += Math.max(0, input.latencyMs);
  if (input.fallback) runtimeSnapshot.fallbackRequests += 1;
  if (input.qualityScore != null && Number.isFinite(input.qualityScore)) {
    runtimeSnapshot.qualityScoreSum += Math.max(0, Math.min(100, input.qualityScore));
    runtimeSnapshot.lastQualityScore = Math.max(0, Math.min(100, input.qualityScore));
  }
  const key = (input.modelUsed || "unknown").trim() || "unknown";
  const stats = (runtimeSnapshot.byModel[key] ??= {
    requests: 0,
    fallback: 0,
    latencyMsSum: 0,
    qualityScoreSum: 0,
  });
  stats.requests += 1;
  if (input.fallback) stats.fallback += 1;
  stats.latencyMsSum += Math.max(0, input.latencyMs);
  if (input.qualityScore != null && Number.isFinite(input.qualityScore)) {
    stats.qualityScoreSum += Math.max(0, Math.min(100, input.qualityScore));
  }
  const avgLatencyMs = stats.requests > 0 ? stats.latencyMsSum / stats.requests : 0;
  const fallbackRate = stats.requests > 0 ? stats.fallback / stats.requests : 0;
  const avgQuality = stats.requests > 0 ? stats.qualityScoreSum / stats.requests : 0;
  analyticsModelLatencyMs.set({ model: key }, avgLatencyMs);
  analyticsModelReliabilityScore.set({ model: key }, Math.max(0, Math.min(100, (1 - fallbackRate) * 100)));
  analyticsModelQualityScore.set({ model: key }, Math.max(0, Math.min(100, avgQuality)));
  // Static price book from env: ANALYTICS_MODEL_COSTS="llama3.2:1b=0.001,mixtral=0.0042"
  const modelCosts = parseModelCostsEnv();
  analyticsModelCostPerReq.set({ model: key }, modelCosts[key] ?? modelCosts["*"] ?? 0);

  const pv = String(input.promptVersion || "unversioned").trim() || "unversioned";
  const ps = (runtimeSnapshot.byPromptVersion[pv] ??= { requests: 0, qualityScoreSum: 0 });
  ps.requests += 1;
  if (input.qualityScore != null && Number.isFinite(input.qualityScore)) {
    ps.qualityScoreSum += Math.max(0, Math.min(100, input.qualityScore));
  }
  analyticsPromptRequestsTotal.inc({ version: pv });
  const avgPromptQuality = ps.requests > 0 ? ps.qualityScoreSum / ps.requests : 0;
  analyticsPromptQualityScore.set({ version: pv }, avgPromptQuality);
  const currentPrompt = String(process.env.ANALYTICS_PROMPT_VERSION || "").trim();
  const previousPrompt = String(process.env.ANALYTICS_PROMPT_PREVIOUS_VERSION || "").trim();
  if (pv === currentPrompt) {
    analyticsPromptQualityCurrent.set(avgPromptQuality);
    analyticsPromptCurrentRequestsTotal.inc();
  } else if (pv === previousPrompt) {
    analyticsPromptQualityPrevious.set(avgPromptQuality);
    analyticsPromptPreviousRequestsTotal.inc();
  }

  const globalTotal = runtimeSnapshot.totalRequests;
  const globalQuality = globalTotal > 0 ? runtimeSnapshot.qualityScoreSum / globalTotal : 0;
  const globalEntropy = input.entropy != null && Number.isFinite(input.entropy) ? input.entropy : 0.5;
  const driftProxy = Math.max(0, Math.min(1, Math.abs(globalQuality / 100 - globalEntropy)));
  analyticsEmbeddingDriftScore.set(driftProxy);
  runtimeSnapshot.lastUpdatedAt = Date.now();
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

export function updateControlPlaneModeGauge(mode: "normal" | "degraded" | "legacy"): void {
  if (mode === "legacy") analyticsControlPlaneMode.set(2);
  else if (mode === "degraded") analyticsControlPlaneMode.set(1);
  else analyticsControlPlaneMode.set(0);
}

export function recordControlPlaneAction(action: string): void {
  analyticsControlPlaneActionsTotal.inc({ action: (action || "unknown").slice(0, 64) });
}

export type AnalyticsRuntimeSnapshot = {
  totalRequests: number;
  fallbackRate: number;
  avgLatencyMs: number;
  avgQualityScore: number;
  lastQualityScore: number;
  byModel: Array<{
    model: string;
    requests: number;
    fallbackRate: number;
    avgLatencyMs: number;
    avgQualityScore: number;
  }>;
};

export function getAnalyticsRuntimeSnapshot(): AnalyticsRuntimeSnapshot {
  const total = Math.max(0, runtimeSnapshot.totalRequests);
  const byModel = Object.entries(runtimeSnapshot.byModel).map(([model, s]) => ({
    model,
    requests: s.requests,
    fallbackRate: s.requests > 0 ? s.fallback / s.requests : 0,
    avgLatencyMs: s.requests > 0 ? s.latencyMsSum / s.requests : 0,
    avgQualityScore: s.requests > 0 ? s.qualityScoreSum / s.requests : 0,
  }));
  return {
    totalRequests: total,
    fallbackRate: total > 0 ? runtimeSnapshot.fallbackRequests / total : 0,
    avgLatencyMs: total > 0 ? runtimeSnapshot.latencyMsSum / total : 0,
    avgQualityScore: total > 0 ? runtimeSnapshot.qualityScoreSum / total : runtimeSnapshot.lastQualityScore,
    lastQualityScore: runtimeSnapshot.lastQualityScore,
    byModel,
  };
}

export function recordArbitrationResult(input: {
  mode: "shadow" | "canary";
  winnerModel: string;
  topScore: number;
  secondScore?: number;
}): void {
  const mode = input.mode;
  const winner = (input.winnerModel || "unknown").trim() || "unknown";
  analyticsModelArbitrationRunsTotal.inc({ mode });
  analyticsModelWinsTotal.inc({ model: winner, mode });
  const second = input.secondScore ?? input.topScore;
  const denom = Math.max(Math.abs(input.topScore), 1e-6);
  const ratio = Math.max(0, Math.min(1, Math.abs(input.topScore - second) / denom));
  analyticsModelArbitrationDisagreementRatio.set(ratio);
}

export function updateClusterHealthGauge(score: number): void {
  const cluster = (process.env.AI_CLUSTER_ID || "cluster-a").trim() || "cluster-a";
  aiClusterHealthScore.set({ cluster }, Math.max(0, Math.min(100, score)));
}

function parseModelCostsEnv(): Record<string, number> {
  const raw = String(process.env.ANALYTICS_MODEL_COSTS || "").trim();
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=", 2).map((s) => s.trim());
    if (!k) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
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
