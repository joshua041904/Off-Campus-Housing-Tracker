import { describe, expect, it } from "vitest";
import { publicRevisionLinesFromChanges, sanitizePublicRevisionChanges } from "../src/listing-revisions-public.js";

describe("sanitizePublicRevisionChanges", () => {
  it("drops private address and owner keys", () => {
    const out = sanitizePublicRevisionChanges({
      title: { from: "A", to: "B" },
      address_line1: { from: "1 Secret St", to: "2 Secret St" },
      user_id: { from: "x", to: "y" },
    });
    expect(out).toEqual({ title: { from: "A", to: "B" } });
  });

  it("returns null when only private keys", () => {
    expect(sanitizePublicRevisionChanges({ address_line1: { from: "a", to: "b" } })).toBeNull();
  });
});

describe("publicRevisionLinesFromChanges", () => {
  it("summarizes media_event added", () => {
    const lines = publicRevisionLinesFromChanges({
      media_event: { from: null, to: { action: "added", media_type: "image" } },
    });
    expect(lines).toContain("Added image");
  });

  it("summarizes media reorder", () => {
    const lines = publicRevisionLinesFromChanges({
      media_event: { from: null, to: { action: "reordered" } },
    });
    expect(lines.some((l) => l.includes("Reordered"))).toBe(true);
  });

  it("does not echo raw uuid in generic field values", () => {
    const lines = publicRevisionLinesFromChanges({
      some_flag: { from: "550e8400-e29b-41d4-a716-446655440000", to: "00000000-0000-4000-8000-000000000001" },
    });
    const joined = lines.join(" ");
    expect(joined).not.toContain("550e8400");
    expect(joined).toContain("(updated)");
  });

  it("uses description label without leaking body", () => {
    const lines = publicRevisionLinesFromChanges({
      description: { from: "secret text", to: "other secret" },
    });
    expect(lines).toEqual(["Description updated"]);
  });
});
