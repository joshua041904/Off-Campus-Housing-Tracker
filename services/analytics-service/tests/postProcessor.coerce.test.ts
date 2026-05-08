import { describe, expect, it } from "vitest";
import { coerceListingIntelligence, unknownToReadableString } from "../src/intelligence/postProcessor.js";

describe("unknownToReadableString", () => {
  it("flattens nested objects instead of [object Object]", () => {
    expect(unknownToReadableString({ type: "location", text: "Near campus" })).toBe("location: Near campus");
    expect(unknownToReadableString({ label: "Rent", detail: "High vs comps" })).toBe("Rent — High vs comps");
    expect(unknownToReadableString([{ text: "a" }, { text: "b" }])).toBe("a; b");
  });
});

describe("coerceListingIntelligence", () => {
  it("coerces object array elements to readable strings", () => {
    const out = coerceListingIntelligence({
      verdict: "Test verdict here for strict pass.",
      market_positioning: "Market positioning paragraph long enough.",
      value_drivers: [{ type: "x", text: "Driver one" }, "plain"],
      risk_flags: [{ label: "L", detail: "D" }],
      missing_information: ["gap"],
      negotiation_leverage: ["lev"],
      confidence_score: 50,
      risk_severity_index: 3,
      pricing_pressure_score: 4,
    });
    expect(out.value_drivers[0]).toContain("Driver");
    expect(out.risk_flags[0]).toContain("L");
  });
});
