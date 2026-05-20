import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: listing-feel passes a per-request `timeoutMs` (quick cap).
 * `ollamaGenerateJson` must honor min(global, params.timeoutMs) so the client
 * is not cut off by a 60s proxy while Ollama still runs at 180s+.
 */
describe("listing intelligence v2 ollama timeout budget", () => {
  const prevV2 = process.env.ANALYTICS_LISTING_INTELLIGENCE_V2;
  const prevGlobal = process.env.ANALYTICS_OLLAMA_TIMEOUT_MS;

  beforeEach(() => {
    process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 = "1";
    process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = "300000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevV2 === undefined) delete process.env.ANALYTICS_LISTING_INTELLIGENCE_V2;
    else process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 = prevV2;
    if (prevGlobal === undefined) delete process.env.ANALYTICS_OLLAMA_TIMEOUT_MS;
    else process.env.ANALYTICS_OLLAMA_TIMEOUT_MS = prevGlobal;
  });

  it("aborts ollamaGenerateJson near params.timeoutMs when global cap is huge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const sig = init?.signal;
          if (!sig) {
            reject(new Error("expected AbortSignal"));
            return;
          }
          if (sig.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
            return;
          }
          sig.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }),
    );

    const { runListingIntelligenceV2 } = await import("../../src/intelligence/listingIntelligenceV2.js");
    /** Floor 250ms in `ollamaGenerateJson`; use 400 so the abort window is stable across CI load. */
    const budgetMs = 400;
    const t0 = Date.now();
    const out = await runListingIntelligenceV2({
      baseUrl: "http://127.0.0.1:1",
      primaryModel: "llama3.2:1b",
      audience: "renter",
      title: "2BR",
      description: "Quiet block. Laundry in unit. ".repeat(40),
      priceUsd: "1200",
      analysis_depth: "standard",
      timeoutMs: budgetMs,
      fetchOnce: globalThis.fetch,
    });
    const elapsed = Date.now() - t0;
    expect(out).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(budgetMs - 120);
    expect(elapsed).toBeLessThan(3000);
  });
});
