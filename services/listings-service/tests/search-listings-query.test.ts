import { describe, expect, it } from "vitest";
import {
  buildListingsSearchQuery,
  parseAmenitySlugs,
} from "../src/search-listings-query.js";

describe("parseAmenitySlugs", () => {
  it("splits CSV and lowercases", () => {
    expect(parseAmenitySlugs("Parking, in_unit_laundry")).toEqual([
      "parking",
      "in_unit_laundry",
    ]);
  });

  it("drops empty segments and invalid tokens", () => {
    expect(parseAmenitySlugs("a,,b")).toEqual(["a", "b"]);
    expect(parseAmenitySlugs("bad token")).toEqual([]);
  });

  it("allows hyphen underscore alnum", () => {
    expect(parseAmenitySlugs("dishwasher,in-unit")).toEqual([
      "dishwasher",
      "in-unit",
    ]);
  });

  it("deduplicates duplicate amenities to keep filtering consistent", () => {
    expect(parseAmenitySlugs("parking, parking, PARKING,garage")).toEqual([
      "parking",
      "garage",
    ]);
  });
});

describe("buildListingsSearchQuery", () => {
  it("defaults sort to created_desc", () => {
    const { sql, params } = buildListingsSearchQuery({});
    expect(sql).toContain("ORDER BY created_at DESC, id ASC");
    expect(params.length).toBe(0);
    expect(sql).toContain("status::text = 'active'");
    expect(sql).toContain("LIMIT 50");
    expect(sql).toContain("OFFSET 0");
  });

  it("uses deterministic tie-breaker for created_desc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "created_desc" });
    expect(sql).toContain("ORDER BY created_at DESC, id ASC");
  });

  it("falls back unknown sort to created_desc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "not_a_real_sort" });
    expect(sql).toContain("ORDER BY created_at DESC, id ASC");
  });

  it("uses deterministic ordering for listed_desc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "listed_desc" });
    expect(sql).toContain(
      "ORDER BY listed_at DESC NULLS LAST, created_at DESC, id ASC",
    );
  });

  it("uses deterministic tie-breaker for price sorts", () => {
    const lowToHigh = buildListingsSearchQuery({ sort: "price_asc" }).sql;
    const highToLow = buildListingsSearchQuery({ sort: "price_desc" }).sql;
    expect(lowToHigh).toContain(
      "ORDER BY price_cents ASC NULLS LAST, created_at DESC, id ASC",
    );
    expect(highToLow).toContain(
      "ORDER BY price_cents DESC NULLS LAST, created_at DESC, id ASC",
    );
  });

  it("adds ILIKE for q and escapes percent/underscore", () => {
    const { sql, params } = buildListingsSearchQuery({ q: "100%_off" });
    expect(sql).toMatch(/ILIKE/i);
    expect(params[0]).toBe("%100\\%\\_off%");
  });

  it("adds price bounds", () => {
    const { sql, params } = buildListingsSearchQuery({
      minP: 100,
      maxP: 500_00,
    });
    expect(sql).toContain("price_cents >=");
    expect(sql).toContain("price_cents <=");
    expect(params).toContain(100);
    expect(params).toContain(500_00);
  });

  it("adds boolean filters without extra params", () => {
    const { sql } = buildListingsSearchQuery({
      smoke: true,
      pets: true,
      furnished: true,
    });
    expect(sql).toContain("smoke_free = true");
    expect(sql).toContain("pet_friendly = true");
    expect(sql).toContain("furnished IS TRUE");
  });

  it("adds pet-friendly filter when pets=true", () => {
    const { sql } = buildListingsSearchQuery({ pets: true });

    expect(sql).toContain("pet_friendly = true");
  });

  it("does not add pet-friendly filter when pets=false", () => {
    const { sql } = buildListingsSearchQuery({ pets: false });

    expect(sql).not.toContain("pet_friendly = true");
  });

  it("only returns pet-friendly constraint when requested", () => {
    const { sql } = buildListingsSearchQuery({ pets: true });

    // ensures no accidental inversion or wrong operator
    expect(sql).toMatch(/pet_friendly\s*=\s*true/);
  });

  it("adds amenity jsonb predicates", () => {
    const { sql, params } = buildListingsSearchQuery({
      amenitySlugs: ["garage", "parking"],
    });
    expect(sql).toContain("amenities::jsonb @>");
    expect(
      params.filter((p) => typeof p === "string" && p.includes("garage"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("does not add duplicate amenity predicates for repeated slugs", () => {
    const { sql } = buildListingsSearchQuery({
      amenitySlugs: ["parking", "parking", "garage"],
    });
    expect((sql.match(/amenities::jsonb @>/g) ?? []).length).toBe(2);
  });

  it("adds newWithin day window", () => {
    const { sql, params } = buildListingsSearchQuery({ newWithin: 7 });
    expect(sql).toContain("INTERVAL '1 day'");
    expect(params).toContain(7);
  });

  it("uses deterministic ordering for price_asc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "price_asc" });
    expect(sql).toContain(
      "ORDER BY price_cents ASC NULLS LAST, created_at DESC, id ASC",
    );
  });

  it("uses deterministic ordering for price_desc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "price_desc" });
    expect(sql).toContain(
      "ORDER BY price_cents DESC NULLS LAST, created_at DESC, id ASC",
    );
  });

  it("applies custom limit and offset", () => {
    const { sql } = buildListingsSearchQuery({ limit: 10, offset: 20 });
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("OFFSET 20");
  });

  it("clamps limit to max", () => {
    const { sql } = buildListingsSearchQuery({ limit: 9999 });
    expect(sql).toContain("LIMIT 100");
  });

  it("defaults offset to 0 when omitted", () => {
    const { sql } = buildListingsSearchQuery({ limit: 10 });
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("OFFSET 0");
  });

  it("falls back to default limit when invalid", () => {
    const { sql } = buildListingsSearchQuery({ limit: 0 });
    expect(sql).toContain("LIMIT 50");
  });

  it("falls back to default offset when invalid", () => {
    const { sql } = buildListingsSearchQuery({ offset: -1 });
    expect(sql).toContain("OFFSET 0");
  });
});
