import { describe, expect, it } from "vitest";
import { buildListingsSearchQuery, parseAmenitySlugs } from "../src/search-listings-query.js";

describe("parseAmenitySlugs", () => {
  it("splits CSV and lowercases", () => {
    expect(parseAmenitySlugs("Parking, in_unit_laundry")).toEqual(["parking", "in_unit_laundry"]);
  });

  it("drops empty segments and invalid tokens", () => {
    expect(parseAmenitySlugs("a,,b")).toEqual(["a", "b"]);
    expect(parseAmenitySlugs("bad token")).toEqual([]);
  });

  it("allows hyphen underscore alnum", () => {
    expect(parseAmenitySlugs("dishwasher,in-unit")).toEqual(["dishwasher", "in-unit"]);
  });

  it("deduplicates duplicate amenities to keep filtering consistent", () => {
    expect(parseAmenitySlugs("parking, parking, PARKING,garage")).toEqual(["parking", "garage"]);
  });
});

describe("buildListingsSearchQuery", () => {
  it("defaults sort to created_desc", () => {
    const { sql, params } = buildListingsSearchQuery({});
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(params.length).toBe(0);
    expect(sql).toContain("status::text = 'active'");
    expect(sql).toContain("LIMIT 50");
  });

  it("uses deterministic tie-breaker for created_desc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "created_desc" });
    expect(sql).toContain("ORDER BY created_at DESC, id ASC");
  });

  it("falls back unknown sort to created_desc", () => {
    const { sql } = buildListingsSearchQuery({ sort: "not_a_real_sort" });
    expect(sql).toContain("ORDER BY created_at DESC");
  });

  it("uses listed_desc when valid", () => {
    const { sql } = buildListingsSearchQuery({ sort: "listed_desc" });
    expect(sql).toContain("ORDER BY listed_at DESC NULLS LAST, created_at DESC, id ASC");
  });

  it("uses deterministic tie-breaker for price sorts", () => {
    const lowToHigh = buildListingsSearchQuery({ sort: "price_asc" }).sql;
    const highToLow = buildListingsSearchQuery({ sort: "price_desc" }).sql;
    expect(lowToHigh).toContain("ORDER BY price_cents ASC NULLS LAST, created_at DESC, id ASC");
    expect(highToLow).toContain("ORDER BY price_cents DESC NULLS LAST, created_at DESC, id ASC");
  });

  it("adds ILIKE for q and escapes percent/underscore", () => {
    const { sql, params } = buildListingsSearchQuery({ q: "100%_off" });
    expect(sql).toMatch(/ILIKE/i);
    expect(params[0]).toBe("%100\\%\\_off%");
  });

  it("adds price bounds", () => {
    const { sql, params } = buildListingsSearchQuery({ minP: 100, maxP: 500_00 });
    expect(sql).toContain("price_cents >=");
    expect(sql).toContain("price_cents <=");
    expect(params).toContain(100);
    expect(params).toContain(500_00);
  });

  it("adds boolean filters without extra params", () => {
    const { sql } = buildListingsSearchQuery({ smoke: true, pets: true, furnished: true });
    expect(sql).toContain("smoke_free = true");
    expect(sql).toContain("pet_friendly = true");
    expect(sql).toContain("furnished IS TRUE");
  });

  it("adds amenity jsonb predicates", () => {
    const { sql, params } = buildListingsSearchQuery({ amenitySlugs: ["garage", "parking"] });
    expect(sql).toContain("amenities::jsonb @>");
    expect(params.filter((p) => typeof p === "string" && p.includes("garage")).length).toBeGreaterThan(0);
  });

  it("does not add duplicate amenity predicates for repeated slugs", () => {
    const { sql } = buildListingsSearchQuery({ amenitySlugs: ["parking", "parking", "garage"] });
    expect((sql.match(/amenities::jsonb @>/g) ?? []).length).toBe(2);
  });

  it("adds newWithin day window", () => {
    const { sql, params } = buildListingsSearchQuery({ newWithin: 7 });
    expect(sql).toContain("INTERVAL '1 day'");
    expect(params).toContain(7);
  });
});
