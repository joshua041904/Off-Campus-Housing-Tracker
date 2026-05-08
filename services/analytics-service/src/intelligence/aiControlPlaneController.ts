import {
  getAnalyticsRuntimeSnapshot,
  recordControlPlaneAction,
  updateClusterHealthGauge,
  updateControlPlaneModeGauge,
} from "./analyticsUnifiedObservabilityMetrics.js";
import { getAiControlPlaneState, patchAiControlPlaneState, type AnalyticsRuntimeMode } from "./aiControlPlaneRuntime.js";

type ControllerMode = "off" | "observe" | "enforce";

function controllerMode(): ControllerMode {
  const raw = String(process.env.ANALYTICS_CONTROL_PLANE_MODE || "observe").trim().toLowerCase();
  if (raw === "off" || raw === "enforce") return raw;
  return "observe";
}

function listCandidateModels(): string[] {
  const raw = String(process.env.ANALYTICS_CONTROL_PLANE_MODELS || process.env.ANALYTICS_ENSEMBLE_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length > 0) return raw;
  const active = (process.env.ANALYTICS_ACTIVE_MODEL || process.env.OLLAMA_MODEL || "llama3.2:1b").trim();
  return [active];
}

function targetRuntimeMode(composite: number, fallbackRate: number, current: AnalyticsRuntimeMode): AnalyticsRuntimeMode {
  if (composite < 50 && fallbackRate > 0.3) return "degraded";
  if (current !== "normal" && composite >= 85 && fallbackRate < 0.1) return "normal";
  return current;
}

function chooseModelFromSnapshot(activeModel: string): string {
  const snap = getAnalyticsRuntimeSnapshot();
  const models = listCandidateModels();
  let best = activeModel;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const model of models) {
    const m = snap.byModel.find((x) => x.model === model);
    if (!m || m.requests < 10) {
      if (model === activeModel) return activeModel;
      continue;
    }
    const quality = Math.max(0, Math.min(1, m.avgQualityScore / 100));
    const reliability = Math.max(0, Math.min(1, 1 - m.fallbackRate));
    const latencyNorm = Math.max(0, Math.min(1, m.avgLatencyMs / 10_000));
    const score = 0.5 * quality + 0.35 * reliability + 0.15 * (1 - latencyNorm);
    if (score > bestScore) {
      bestScore = score;
      best = model;
    }
  }
  return best;
}

function estimateCompositeScore(): number {
  const snap = getAnalyticsRuntimeSnapshot();
  // Phase A approximation from in-process signals only (Phase B upgrades this with Prometheus-derived composite).
  const quality = Math.max(0, Math.min(1, snap.avgQualityScore / 100));
  const reliability = Math.max(0, Math.min(1, 1 - snap.fallbackRate));
  const latencyNorm = Math.max(0, Math.min(1, snap.avgLatencyMs / 12_000));
  return Math.round((0.5 * quality + 0.35 * reliability + 0.15 * (1 - latencyNorm)) * 100);
}

async function queryPrometheusScalar(promUrl: string, expr: string): Promise<number | undefined> {
  const u = new URL(promUrl);
  u.searchParams.set("query", expr);
  const res = await fetch(u.toString(), { method: "GET", signal: AbortSignal.timeout(2500) });
  if (!res.ok) return undefined;
  const body = (await res.json()) as {
    status?: string;
    data?: { result?: Array<{ value?: [number | string, number | string] }> };
  };
  if (body.status !== "success") return undefined;
  const val = body.data?.result?.[0]?.value?.[1];
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

async function maybeCompositeFromPrometheus(localComposite: number): Promise<number> {
  const enabled = process.env.ANALYTICS_CONTROL_PLANE_PROM_ENABLED === "1";
  const url =
    (process.env.ANALYTICS_CONTROL_PLANE_PROM_QUERY_URL || "http://prometheus.observability.svc.cluster.local:9090/prometheus/api/v1/query").trim();
  if (!enabled || !url) return localComposite;
  const expr = (process.env.ANALYTICS_CONTROL_PLANE_COMPOSITE_QUERY || "ai_health_composite_score").trim();
  try {
    const remote = await queryPrometheusScalar(url, expr);
    return remote != null ? Math.max(0, Math.min(100, remote)) : localComposite;
  } catch {
    return localComposite;
  }
}

async function maybeScalarFromPrometheus(exprEnv: string): Promise<number | undefined> {
  const enabled = process.env.ANALYTICS_CONTROL_PLANE_PROM_ENABLED === "1";
  const url =
    (process.env.ANALYTICS_CONTROL_PLANE_PROM_QUERY_URL || "http://prometheus.observability.svc.cluster.local:9090/prometheus/api/v1/query").trim();
  const expr = String(process.env[exprEnv] || "").trim();
  if (!enabled || !url || !expr) return undefined;
  try {
    return await queryPrometheusScalar(url, expr);
  } catch {
    return undefined;
  }
}

function maybeRollbackPromptVersion(): string | undefined {
  const current = getAiControlPlaneState();
  const previous = String(process.env.ANALYTICS_PROMPT_PREVIOUS_VERSION || "").trim();
  if (!previous || previous === current.promptVersion) return undefined;
  if (current.runtimeMode !== "normal") return undefined;
  const snap = getAnalyticsRuntimeSnapshot();
  if (snap.totalRequests < 100) return undefined;
  if (snap.avgQualityScore < Number(process.env.ANALYTICS_PROMPT_ROLLBACK_MIN_QUALITY || "45")) {
    return previous;
  }
  return undefined;
}

function targetCanaryPercent(params: { current: number; composite: number; driftZ?: number }): number {
  if (params.composite < 60) return Math.max(params.current, 10);
  if ((params.driftZ ?? 0) > 3) return Math.max(params.current, 30);
  if (params.composite > 88 && (params.driftZ ?? 0) < 1) return 0;
  return params.current;
}

export function startAiControlPlaneController(): void {
  const mode = controllerMode();
  if (mode === "off") {
    console.log("[ai-control-plane] disabled");
    return;
  }
  const intervalMs = Math.max(5000, Number(process.env.ANALYTICS_CONTROL_PLANE_INTERVAL_MS || "30000"));
  const cooldownMs = Math.max(10000, Number(process.env.ANALYTICS_CONTROL_PLANE_COOLDOWN_MS || "120000"));
  let lastMutationAt = 0;
  const loop = async () => {
    const state = getAiControlPlaneState();
    updateControlPlaneModeGauge(state.runtimeMode);
    const snap = getAnalyticsRuntimeSnapshot();
    if (snap.totalRequests < 20) return;
    const localComposite = estimateCompositeScore();
    const composite = await maybeCompositeFromPrometheus(localComposite);
    updateClusterHealthGauge(composite);
    const nextMode = targetRuntimeMode(composite, snap.fallbackRate, state.runtimeMode);
    const nextModel = chooseModelFromSnapshot(state.activeModel);
    const driftZ = await maybeScalarFromPrometheus("ANALYTICS_CONTROL_PLANE_DRIFT_QUERY");
    const promptDelta = await maybeScalarFromPrometheus("ANALYTICS_CONTROL_PLANE_PROMPT_DELTA_QUERY");
    const rollbackPrompt = promptDelta != null && promptDelta < -8 ? maybeRollbackPromptVersion() : undefined;
    const nextCanaryPercent = targetCanaryPercent({
      current: state.canaryPercent,
      composite,
      driftZ,
    });
    const planned = {
      runtimeMode: nextMode,
      activeModel: nextModel,
      promptVersion: rollbackPrompt,
      canaryPercent: nextCanaryPercent,
      composite,
      fallbackRate: snap.fallbackRate,
      driftZ,
      promptDelta,
    };
    const shouldMutate =
      nextMode !== state.runtimeMode ||
      nextModel !== state.activeModel ||
      nextCanaryPercent !== state.canaryPercent ||
      (rollbackPrompt && rollbackPrompt !== state.promptVersion);
    if (!shouldMutate) return;
    if (Date.now() - lastMutationAt < cooldownMs) return;
    if (mode === "observe") {
      console.log("[ai-control-plane][observe]", planned);
      recordControlPlaneAction("observe_decision");
      return;
    }
    const patch: Parameters<typeof patchAiControlPlaneState>[0] = { updatedBy: "ai_control_plane_controller" };
    if (nextMode !== state.runtimeMode) patch.runtimeMode = nextMode;
    if (nextModel !== state.activeModel) patch.activeModel = nextModel;
    if (nextCanaryPercent !== state.canaryPercent) patch.canaryPercent = nextCanaryPercent;
    if (rollbackPrompt && rollbackPrompt !== state.promptVersion) patch.promptVersion = rollbackPrompt;
    patchAiControlPlaneState(patch);
    recordControlPlaneAction("state_mutation");
    lastMutationAt = Date.now();
    const after = getAiControlPlaneState();
    updateControlPlaneModeGauge(after.runtimeMode);
    console.log("[ai-control-plane][enforce]", { before: state, after, composite });
  };
  void loop();
  setInterval(() => {
    void loop();
  }, intervalMs).unref?.();
  console.log(`[ai-control-plane] started mode=${mode} interval_ms=${intervalMs} cooldown_ms=${cooldownMs}`);
}
