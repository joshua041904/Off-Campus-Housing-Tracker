import { describe, expect, it } from "vitest";
import {
  computeVerdictEntropy,
  jaccardSimilarity,
  riskFlagDiversity,
  stddev,
} from "../../src/intelligence/variabilityMetrics.js";

describe("variabilityMetrics", () => {
  it("jaccardSimilarity — identical strings", () => {
    expect(jaccardSimilarity("a b c", "c b a")).toBe(1);
  });

  it("computeVerdictEntropy — identical verdicts → 0", () => {
    expect(computeVerdictEntropy(["same text", "same text", "same text"])).toBe(0);
  });

  it("computeVerdictEntropy — different verdicts → > 0", () => {
    const e = computeVerdictEntropy([
      "quiet block laundry",
      "noisy street utilities unclear",
      "campus walk pets ok",
    ]);
    expect(e).toBeGreaterThan(0.2);
  });

  it("riskFlagDiversity", () => {
    const d = riskFlagDiversity([
      { risk_flags: ["a", "b"] },
      { risk_flags: ["b", "c"] },
    ]);
    expect(d).toBeGreaterThan(0.5);
  });

  it("stddev", () => {
    expect(stddev([10, 10, 10])).toBe(0);
    expect(stddev([0, 10])).toBe(5);
  });
});
