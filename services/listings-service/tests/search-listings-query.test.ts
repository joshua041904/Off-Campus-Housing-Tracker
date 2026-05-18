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
  it("defaults sort to created_desc via parameterized CASE ordering", () => {
    const { sql, params } = buildListingsSearchQuery({});
    expect(sql).toContain("WITH filtered AS");
    expect(sql).toContain("CASE WHEN $");
    expect(sql).toContain("created_at DESC");
    expect(sql).toContain("id ASC");
    expect(params[params.length - 1]).toBe(3);
    expect(sql).toContain("status::text = 'active'");
    expect(sql).toContain("LIMIT 50");
    expect(sql).toContain("OFFSET 0");
  });

  it("uses deterministic tie-breaker for created_desc", () => {
    const { sql, params } = buildListingsSearchQuery({ sort: "created_desc" });
    expect(sql).toContain("created_at DESC");
    expect(sql).toContain("id ASC");
    expect(params[params.length - 1]).toBe(3);
  });

  it("falls back unknown sort to created_desc", () => {
    const { sql, params } = buildListingsSearchQuery({ sort: "not_a_real_sort" });
    expect(sql).toContain("created_at DESC");
    expect(params[params.length - 1]).toBe(3);
  });

  it("uses deterministic ordering for listed_desc", () => {
    const { sql, params } = buildListingsSearchQuery({ sort: "listed_desc" });
    expect(sql).toContain("listed_at END DESC NULLS LAST");
    expect(params[params.length - 1]).toBe(4);
  });

  it("uses deterministic tie-breaker for price sorts", () => {
    const lowToHigh = buildListingsSearchQuery({ sort: "price_asc" }).sql;
    const highToLow = buildListingsSearchQuery({ sort: "price_desc" }).sql;
    expect(lowToHigh).toContain("price_cents END ASC NULLS LAST");
    expect(highToLow).toContain("price_cents END DESC NULLS LAST");
    expect(lowToHigh).toContain("created_at DESC");
    expect(highToLow).toContain("id ASC");
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
    const { sql, params } = buildListingsSearchQuery({ sort: "price_asc" });
    expect(sql).toContain("price_cents END ASC NULLS LAST");
    expect(params[params.length - 1]).toBe(1);
  });

  it("uses deterministic ordering for price_desc", () => {
    const { sql, params } = buildListingsSearchQuery({ sort: "price_desc" });
    expect(sql).toContain("price_cents END DESC NULLS LAST");
    expect(params[params.length - 1]).toBe(2);
  });

  it("uses distance sort CASE arm", () => {
    const { sql, params } = buildListingsSearchQuery({ sort: "distance_asc" });
    expect(sql).toContain("pow(coalesce(latitude");
    expect(params[params.length - 1]).toBe(5);
  });

  it("applies custom limit and offset", () => {
    const { sql } = buildListingsSearchQuery({ limit: 10, offset: 20 });
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("OFFSET 20");
  });

  it("clamps limit to max", () => {
    const { sql } = buildListingsSearchQuery({ limit: 9999 });
    expect(sql).toContain("LIMIT 240");
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

  it("filters by residence_type ANY", () => {
    const { sql, params } = buildListingsSearchQuery({
      residenceTypes: ["apartment", "condo"],
    });
    expect(sql).toContain("residence_type = ANY");
    const arr = params.find((p) => Array.isArray(p)) as string[] | undefined;
    expect(arr?.sort()).toEqual(["apartment", "condo"].sort());
  });

  it("filters campusWithinMiles using haversine to campus", () => {
    const { sql, params } = buildListingsSearchQuery({ campusWithinMiles: 1.5 });
    expect(sql).toContain("3959.0 * acos");
    expect(params.some((p) => p === 1.5)).toBe(true);
  });

  it("filters min and max sqft", () => {
    const { sql, params } = buildListingsSearchQuery({ minSqft: 500, maxSqft: 1200 });
    expect(sql).toContain("size_sqft");
    expect(params).toContain(500);
    expect(params).toContain(1200);
  });
});
