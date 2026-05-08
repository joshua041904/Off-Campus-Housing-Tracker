import { describe, expect, it } from "vitest";
import { assertValidListingIntelligenceStrict } from "../../src/intelligence/structuredValidation.js";
import type { ListingIntelligenceOutput } from "../../src/intelligence/types.js";

function valid(): ListingIntelligenceOutput {
  return {
    verdict: "Test verdict.",
    market_positioning: "Position.",
    value_drivers: ["One"],
    pricing_signal: "",
    risk_flags: ["R1"],
    missing_information: ["M1"],
    negotiation_leverage: ["L1"],
    negotiation_strategy: "",
    confidence_score: 50,
    risk_severity_index: 5,
    pricing_pressure_score: 5,
  };
}

describe("structuredValidation", () => {
  it("accepts full contract", () => {
    expect(() => assertValidListingIntelligenceStrict(valid())).not.toThrow();
  });

  it("rejects missing market_positioning", () => {
    const o = { ...valid(), market_positioning: "" };
    expect(() => assertValidListingIntelligenceStrict(o)).toThrow(/market_positioning/);
  });

  it("rejects empty value_drivers", () => {
    const o = { ...valid(), value_drivers: [] };
    expect(() => assertValidListingIntelligenceStrict(o)).toThrow(/value_drivers/);
  });
});
