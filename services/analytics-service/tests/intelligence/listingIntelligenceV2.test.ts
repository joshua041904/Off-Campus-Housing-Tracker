import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("listing intelligence v2", () => {
  const prev = process.env.ANALYTICS_LISTING_INTELLIGENCE_V2;

  beforeEach(() => {
    process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 = "1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            response: JSON.stringify({
              verdict: "Fair ask for the stated amenities.",
              market_positioning: "Mid-market student-adjacent.",
              value_drivers: ["Solid amenity package vs peers.", "Walkable location stated clearly."],
              pricing_signal: "Slightly above micro-average for size.",
              risk_flags: ["Utilities vague", "Pet policy unclear"],
              missing_information: ["Utility inclusion scope", "Pet deposit"],
              negotiation_leverage: ["Ask for all-in monthly cap in writing.", "Confirm pet rules before applying."],
              negotiation_strategy: "",
              confidence_score: 72,
              risk_severity_index: 4,
              pricing_pressure_score: 5,
            }),
          }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prev === undefined) delete process.env.ANALYTICS_LISTING_INTELLIGENCE_V2;
    else process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 = prev;
  });

  it("isListingIntelligenceV2Enabled is false under dev-fast unless ANALYTICS_LI_V2_IN_DEV_FAST", async () => {
    const { isListingIntelligenceV2Enabled } = await import("../../src/intelligence/listingIntelligenceV2.js");
    process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 = "1";
    process.env.ANALYTICS_DEV_FAST_MODE = "1";
    delete process.env.ANALYTICS_LI_V2_IN_DEV_FAST;
    expect(isListingIntelligenceV2Enabled()).toBe(false);
    process.env.ANALYTICS_LI_V2_IN_DEV_FAST = "1";
    expect(isListingIntelligenceV2Enabled()).toBe(true);
    delete process.env.ANALYTICS_DEV_FAST_MODE;
    delete process.env.ANALYTICS_LI_V2_IN_DEV_FAST;
  });

  it("runListingIntelligenceV2 returns structured bullets and meta", async () => {
    const { runListingIntelligenceV2 } = await import("../../src/intelligence/listingIntelligenceV2.js");
    const out = await runListingIntelligenceV2({
      baseUrl: "http://127.0.0.1:1",
      primaryModel: "llama3.2:1b",
      audience: "renter",
      title: "2BR near campus",
      description: "Hardwood floors. In-unit laundry. No pets.",
      priceUsd: "2400.00",
      analysis_depth: "standard",
      timeoutMs: 30_000,
      fetchOnce: globalThis.fetch,
    });
    expect(out).not.toBeNull();
    expect(out!.analysis_text).toContain("Verdict:");
    expect(out!.analysis_text).toContain("Risk:");
    expect(out!.meta.contract_version).toBe("listing-intelligence.v2");
    expect(out!.meta.primary_mode).toBe("renter_defensive");
    expect(out!.meta.confidence_explanation).toMatch(/Calibrated confidence/);
    expect(out!.intelligence.risk_flags.length).toBeGreaterThanOrEqual(1);
    expect(out!.generation_meta.truncated).toBe(false);
    expect(out!.generation_meta.max_tokens).toBeLessThanOrEqual(1000);
    expect(out!.generation_meta.token_estimate).toBeGreaterThan(0);
  });
});
