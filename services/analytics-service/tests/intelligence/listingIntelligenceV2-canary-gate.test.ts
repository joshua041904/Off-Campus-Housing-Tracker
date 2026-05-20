import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Own file so we never vi.resetModules() (prom-client metrics would double-register).
 * Env must be set before the first dynamic import of analytics modules.
 */
describe("listing intelligence v2 canary gate", () => {
  let runListingIntelligenceV2: typeof import("../../src/intelligence/listingIntelligenceV2.js").runListingIntelligenceV2;

  beforeAll(async () => {
    process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 = "1";
    process.env.ANALYTICS_CANARY_MODEL = "llama3.2:3b";
    process.env.ANALYTICS_CANARY_SHADOW = "1";
    process.env.ANALYTICS_CANARY_PERCENT = "0";
    delete process.env.ANALYTICS_DEV_FAST_MODE;
    delete process.env.ANALYTICS_QA_FAST_MODE;

    ({ runListingIntelligenceV2 } = await import("../../src/intelligence/listingIntelligenceV2.js"));
  });

  afterAll(() => {
    delete process.env.ANALYTICS_CANARY_MODEL;
    delete process.env.ANALYTICS_CANARY_SHADOW;
    delete process.env.ANALYTICS_CANARY_PERCENT;
    vi.unstubAllGlobals();
  });

  it("quick + shadow=1 + canary percent 0 => single /api/generate (no shadow fan-out)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          response: JSON.stringify({
            verdict: "Quick take.",
            market_positioning: "Compact.",
            value_drivers: ["A"],
            pricing_signal: "",
            risk_flags: ["B"],
            missing_information: ["C"],
            negotiation_leverage: ["D"],
            negotiation_strategy: "",
            confidence_score: 60,
            risk_severity_index: 3,
            pricing_pressure_score: 4,
          }),
        }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const out = await runListingIntelligenceV2({
      baseUrl: "http://127.0.0.1:1",
      primaryModel: "llama3.2:1b",
      audience: "renter",
      title: "Studio",
      description: "Small studio near campus.",
      priceUsd: "1200",
      analysis_depth: "quick",
      timeoutMs: 30_000,
      fetchOnce: globalThis.fetch,
    });
    expect(out).not.toBeNull();
    const generateCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("/api/generate"),
    );
    expect(generateCalls.length).toBe(1);
  });
});
