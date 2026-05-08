/**
 * Dev/staging chaos hooks for listing-feel reliability tests.
 * Blocked in production unless ANALYTICS_AI_CHAOS_ALLOW_IN_PROD=1.
 *
 * AI_CHAOS_MODE or ANALYTICS_AI_CHAOS_MODE:
 *   timeout — sleep 6s before Ollama fetch (triggers timeouts on short client budgets)
 *   throw   — throw before Ollama fetch
 */

function chaosMode(): string {
  return (process.env.AI_CHAOS_MODE || process.env.ANALYTICS_AI_CHAOS_MODE || "").trim().toLowerCase();
}

function chaosAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ANALYTICS_AI_CHAOS_ALLOW_IN_PROD === "1" || process.env.ANALYTICS_AI_CHAOS_ALLOW_IN_PROD === "true";
}

export async function maybeInjectAiChaos(phase: string): Promise<void> {
  const mode = chaosMode();
  if (!mode || !chaosAllowed()) return;

  if (mode === "timeout") {
    await new Promise((r) => setTimeout(r, 6000));
    return;
  }
  if (mode === "throw") {
    throw new Error(`AI_CHAOS_MODE=throw@${phase}`);
  }
}
