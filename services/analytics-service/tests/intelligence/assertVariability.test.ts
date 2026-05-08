import { describe, expect, it } from "vitest";
import {
  AnalyticsEntropyAssertionError,
  assertDeterminism,
  assertVariability,
} from "../../src/intelligence/assertVariability.js";

describe("assertVariability", () => {
  it("assertDeterminism passes at boundary", () => {
    expect(() => assertDeterminism(0.05, 0)).not.toThrow();
  });

  it("assertDeterminism fails when entropy too high at temp 0", () => {
    expect(() => assertDeterminism(0.06, 0)).toThrow(AnalyticsEntropyAssertionError);
  });

  it("assertVariability passes at boundary", () => {
    expect(() => assertVariability(0.25, 0.7)).not.toThrow();
  });

  it("assertVariability fails when entropy too low at temp > 0", () => {
    expect(() => assertVariability(0.24, 0.7)).toThrow(AnalyticsEntropyAssertionError);
  });
});
