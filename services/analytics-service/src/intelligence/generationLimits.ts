/** Hard server-side cap for Ollama `num_predict` (generation tokens). */
export const MAX_GENERATION_TOKENS = 800;

/**
 * When ANALYTICS_DEV_FAST_MODE is on (e.g. `make ollama-env`), cap generations so local Metal
 * stays responsive. Override with ANALYTICS_DEV_FAST_MAX_GENERATION_TOKENS (default 512).
 */
export function devFastMaxGenerationTokens(): number {
  const n = Number(process.env.ANALYTICS_DEV_FAST_MAX_GENERATION_TOKENS ?? "400");
  if (!Number.isFinite(n) || n < 64) return 400;
  return Math.min(MAX_GENERATION_TOKENS, Math.floor(n));
}

export function isAnalyticsDevFastMode(): boolean {
  return process.env.ANALYTICS_DEV_FAST_MODE === "1" || process.env.ANALYTICS_DEV_FAST_MODE === "true";
}

export function applyDevFastTokenCap(n: number): number {
  if (!isAnalyticsDevFastMode()) return n;
  return Math.min(Math.floor(n), devFastMaxGenerationTokens());
}

export function clampNumPredict(requested: number): number {
  if (!Number.isFinite(requested)) return 250;
  const rounded = Math.floor(requested);
  if (rounded < 1) return 1;
  return Math.min(MAX_GENERATION_TOKENS, rounded);
}
