/**
 * Single source of truth for Ollama HTTP timeouts (legacy /api/generate + Listing Intelligence v2).
 * Legacy path and v2 must use the same budget so behavior matches across code paths.
 */

function readRequestedTimeoutMs(): number {
  const n = Number(process.env.ANALYTICS_OLLAMA_TIMEOUT_MS ?? "120000");
  return Number.isFinite(n) && n > 5000 ? Math.floor(n) : 120_000;
}

function readGenerateCapMs(): number {
  const n = Number(process.env.ANALYTICS_OLLAMA_GENERATE_CAP_MS ?? "300000");
  return Number.isFinite(n) && n >= 5000 ? Math.floor(n) : 300_000;
}

/**
 * Effective timeout for `AbortSignal.timeout` / `AbortController` around Ollama `/api/generate`.
 *
 * - Normal: min(ANALYTICS_OLLAMA_TIMEOUT_MS, ANALYTICS_OLLAMA_GENERATE_CAP_MS) — no hidden 45s/60s caps.
 * - QA fast: max 20s
 * - Dev fast: min(requested, ANALYTICS_DEV_FAST_OLLAMA_CAP_MS) default 120s
 * - UI mode: min(ANALYTICS_OLLAMA_UI_HARD_MS, 60s)
 */
export function getOllamaGenerateTimeoutMs(): number {
  const raw = readRequestedTimeoutMs();
  const ceiling = readGenerateCapMs();

  const qaFast = process.env.ANALYTICS_QA_FAST_MODE === "1" || process.env.ANALYTICS_QA_FAST_MODE === "true";
  if (qaFast) {
    return Math.min(raw, 20_000);
  }

  const devFast = process.env.ANALYTICS_DEV_FAST_MODE === "1" || process.env.ANALYTICS_DEV_FAST_MODE === "true";
  if (devFast) {
    const devCap = Number(process.env.ANALYTICS_DEV_FAST_OLLAMA_CAP_MS ?? "120000");
    const dc = Number.isFinite(devCap) && devCap >= 5000 ? Math.floor(devCap) : 120_000;
    return Math.min(raw, dc);
  }

  const ui = process.env.ANALYTICS_UI_MODE === "1" || process.env.ANALYTICS_UI_MODE === "true";
  const uiHard = Number(process.env.ANALYTICS_OLLAMA_UI_HARD_MS ?? "10000");
  if (ui && Number.isFinite(uiHard) && uiHard > 0) {
    return Math.min(Math.floor(uiHard), 60_000);
  }

  return Math.min(raw, ceiling);
}
