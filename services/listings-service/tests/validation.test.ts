import { describe, expect, it } from "vitest";
import {
  isValidUuid,
  validateCreateListingInput,
  validateListingId,
  validateSearchFilters,
  validateUserId,
} from "../src/validation.js";

const VALID_USER = "11111111-1111-4111-8111-111111111111";

describe("validateListingId", () => {
  it("rejects empty", () => {
    const r = validateListingId("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/required/i);
  });

  it("rejects non-uuid", () => {
    const r = validateListingId("not-a-uuid");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/valid UUID/i);
  });

  it("accepts lowercase RFC variant bits", () => {
    const id = "aaaaaaaa-bbbb-4ccc-baaa-eeeeeeeeeeee";
    const r = validateListingId(id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(id);
  });
});

describe("validateUserId", () => {
  it("accepts valid uuid", () => {
    const r = validateUserId(VALID_USER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(VALID_USER);
  });

  it("rejects invalid", () => {
    expect(validateUserId("x").ok).toBe(false);
  });
});

describe("validateCreateListingInput", () => {
  const base = {
    user_id: VALID_USER,
    title: "Studio",
    description: "Near campus",
    price_cents: 1000,
    amenities: ["parking"],
    smoke_free: true,
    pet_friendly: false,
    furnished: true,
    effective_from: "2026-06-01",
    effective_until: "",
  };

  it("returns normalized value on success", () => {
    const r = validateCreateListingInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.user_id).toBe(VALID_USER);
      expect(r.value.title).toBe("Studio");
      expect(r.value.price_cents).toBe(1000);
      expect(r.value.effective_from).toBe("2026-06-01");
      expect(r.value.effective_until).toBe("");
    }
  });

  it("requires title", () => {
    const r = validateCreateListingInput({ ...base, title: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/title/i);
  });

  it("requires positive integer price_cents", () => {
    expect(validateCreateListingInput({ ...base, price_cents: 0 }).ok).toBe(
      false,
    );
    expect(validateCreateListingInput({ ...base, price_cents: 1.5 }).ok).toBe(
      false,
    );
  });

  it("validates effective_from date", () => {
    const r = validateCreateListingInput({
      ...base,
      effective_from: "2026-13-40",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/effective_from/i);
  });

  it("rejects effective_until before effective_from", () => {
    const r = validateCreateListingInput({
      ...base,
      effective_from: "2026-06-10",
      effective_until: "2026-06-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/earlier/i);
  });

  it("allows requireUserId false for gRPC-style bodies", () => {
    const r = validateCreateListingInput(
      { ...base, user_id: undefined },
      { requireUserId: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.user_id).toBe("");
  });

  it("fails when title is missing", () => {
    const result = validateCreateListingInput({
      user_id: VALID_USER,
      price_cents: 100,
      effective_from: "2030-01-01",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/title/i);
  });

  it("fails when price is missing", () => {
    const result = validateCreateListingInput({
      user_id: VALID_USER,
      title: "Test",
      effective_from: "2030-01-01",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/price_cents/i);
  });

  it("fails for negative price", () => {
    const result = validateCreateListingInput({
      user_id: VALID_USER,
      title: "Test",
      price_cents: -10,
      effective_from: "2030-01-01",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/price_cents/i);
  });
});

describe("validateSearchFilters", () => {
  it("accepts empty", () => {
    const r = validateSearchFilters({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.min_price).toBeNull();
      expect(r.value.max_price).toBeNull();
    }
  });

  it("rejects min > max", () => {
    const r = validateSearchFilters({ min_price: 500, max_price: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/min_price/i);
  });

  it("rejects negative min_price string", () => {
    const r = validateSearchFilters({ min_price: -1 });
    expect(r.ok).toBe(false);
  });
});

describe("isValidUuid", () => {
  it("matches RFC-style pattern used by validation", () => {
    expect(isValidUuid("aaaaaaaa-bbbb-4ccc-baaa-eeeeeeeeeeee")).toBe(true);
    expect(isValidUuid("not-uuid")).toBe(false);
  });
});
