import { describe, expect, it } from "vitest";
import { computeListingRevisionChanges } from "../src/listing-revision-diff.js";

describe("computeListingRevisionChanges", () => {
  it("returns empty when before and after match", () => {
    const row = { title: "A", price_cents: 1000 };
    expect(computeListingRevisionChanges(row, { title: "A", price_cents: 1000 })).toEqual({});
  });

  it("records field deltas", () => {
    const before = { title: "Old", price_cents: 1000, description: "x" };
    const after = { title: "New", price_cents: 1000, description: "x" };
    const d = computeListingRevisionChanges(before, after);
    expect(d.title).toEqual({ from: "Old", to: "New" });
    expect(d.price_cents).toBeUndefined();
  });

  it("records pricing_mode changes", () => {
    const before = { title: "A", pricing_mode: "fixed", price_cents: 1000 };
    const after = { title: "A", pricing_mode: "obo", price_cents: 1000 };
    const d = computeListingRevisionChanges(before, after);
    expect(d.pricing_mode).toEqual({ from: "fixed", to: "obo" });
  });
});
