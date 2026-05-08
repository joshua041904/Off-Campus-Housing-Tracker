export type AnalyticsRuntimeMode = "normal" | "degraded" | "legacy";

export type ArbitrationWeights = {
  quality: number;
  latency: number;
  reliability: number;
  cost: number;
};

export type AiControlPlaneState = {
  runtimeMode: AnalyticsRuntimeMode;
  activeModel: string;
  promptVersion: string;
  canaryPercent: number;
  arbitrationWeights: ArbitrationWeights;
  updatedAt: number;
  updatedBy: string;
};

const DEFAULT_ARBITRATION_WEIGHTS: ArbitrationWeights = {
  quality: 0.4,
  latency: 0.2,
  reliability: 0.2,
  cost: 0.2,
};

function parseRuntimeMode(raw: string | undefined): AnalyticsRuntimeMode {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "degraded" || v === "legacy") return v;
  return "normal";
}

function parsePercent(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseWeight(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeWeights(input: ArbitrationWeights): ArbitrationWeights {
  const sum = input.quality + input.latency + input.reliability + input.cost;
  if (sum <= 0) return DEFAULT_ARBITRATION_WEIGHTS;
  return {
    quality: input.quality / sum,
    latency: input.latency / sum,
    reliability: input.reliability / sum,
    cost: input.cost / sum,
  };
}

const state: AiControlPlaneState = {
  runtimeMode: parseRuntimeMode(process.env.ANALYTICS_RUNTIME_MODE),
  activeModel: (process.env.ANALYTICS_ACTIVE_MODEL || process.env.OLLAMA_MODEL || "llama3.2:1b").trim(),
  promptVersion: (process.env.ANALYTICS_PROMPT_VERSION || "unversioned").trim(),
  canaryPercent: parsePercent(process.env.ANALYTICS_CANARY_PERCENT, 0),
  arbitrationWeights: normalizeWeights({
    quality: parseWeight(process.env.ANALYTICS_ARBITRATION_WEIGHT_QUALITY, DEFAULT_ARBITRATION_WEIGHTS.quality),
    latency: parseWeight(process.env.ANALYTICS_ARBITRATION_WEIGHT_LATENCY, DEFAULT_ARBITRATION_WEIGHTS.latency),
    reliability: parseWeight(process.env.ANALYTICS_ARBITRATION_WEIGHT_RELIABILITY, DEFAULT_ARBITRATION_WEIGHTS.reliability),
    cost: parseWeight(process.env.ANALYTICS_ARBITRATION_WEIGHT_COST, DEFAULT_ARBITRATION_WEIGHTS.cost),
  }),
  updatedAt: Date.now(),
  updatedBy: "bootstrap",
};

export function getAiControlPlaneState(): AiControlPlaneState {
  return {
    ...state,
    arbitrationWeights: { ...state.arbitrationWeights },
  };
}

export type AiControlPlanePatch = Partial<{
  runtimeMode: AnalyticsRuntimeMode;
  activeModel: string;
  promptVersion: string;
  canaryPercent: number;
  arbitrationWeights: Partial<ArbitrationWeights>;
  updatedBy: string;
}>;

export function patchAiControlPlaneState(patch: AiControlPlanePatch): AiControlPlaneState {
  if (patch.runtimeMode) state.runtimeMode = patch.runtimeMode;
  if (typeof patch.activeModel === "string" && patch.activeModel.trim()) {
    state.activeModel = patch.activeModel.trim();
  }
  if (typeof patch.promptVersion === "string" && patch.promptVersion.trim()) {
    state.promptVersion = patch.promptVersion.trim();
  }
  if (typeof patch.canaryPercent === "number" && Number.isFinite(patch.canaryPercent)) {
    state.canaryPercent = Math.max(0, Math.min(100, Math.round(patch.canaryPercent)));
  }
  if (patch.arbitrationWeights) {
    state.arbitrationWeights = normalizeWeights({
      quality: patch.arbitrationWeights.quality ?? state.arbitrationWeights.quality,
      latency: patch.arbitrationWeights.latency ?? state.arbitrationWeights.latency,
      reliability: patch.arbitrationWeights.reliability ?? state.arbitrationWeights.reliability,
      cost: patch.arbitrationWeights.cost ?? state.arbitrationWeights.cost,
    });
  }
  state.updatedAt = Date.now();
  state.updatedBy = (patch.updatedBy || "unknown").trim() || "unknown";
  return getAiControlPlaneState();
}

export function getRuntimeModel(): string {
  return state.activeModel;
}

export function getRuntimeMode(): AnalyticsRuntimeMode {
  return state.runtimeMode;
}

export function getPromptVersion(): string {
  return state.promptVersion;
}
