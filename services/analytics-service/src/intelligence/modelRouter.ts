import type { AnalysisDepth } from "./types.js";
import { latencyDegradesEnsemble } from "./latencyThrottle.js";

export function parseEnsembleModels(): string[] {
  const raw = (process.env.ANALYTICS_ENSEMBLE_MODELS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function shouldUseEnsemble(params: {
  descriptionLength: number;
  depth: AnalysisDepth;
  modelCount: number;
}): boolean {
  if (params.modelCount < 2) return false;
  if (process.env.ANALYTICS_ENSEMBLE_ENABLED !== "1") return false;
  if (latencyDegradesEnsemble()) return false;
  if (params.depth === "deep") return true;
  if (params.descriptionLength > 800) return true;
  if (params.depth === "quick") return false;
  return false;
}
