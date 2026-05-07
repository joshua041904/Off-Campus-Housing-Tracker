import { describe, expect, it } from "vitest";
import { detectNumericContradictionInProse } from "../../src/intelligence/analysisConsistency.js";

describe("analysisConsistency", () => {
  it("flags two incompatible asking rents in one sentence", () => {
    const text =
      "The asking price is $1200 and the asking rent is $2700 for this listing in the same breath.";
    const r = detectNumericContradictionInProse(text, 1200);
    expect(r.conflict).toBe(true);
  });

  it("passes consistent single asking rent", () => {
    const text =
      "Pricing vs comps: At $1200/month this unit undercuts similar 2BR listings. Value drivers include laundry and location.";
    expect(detectNumericContradictionInProse(text, 1200).conflict).toBe(false);
  });
});
