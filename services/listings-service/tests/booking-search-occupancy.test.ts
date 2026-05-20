import { describe, expect, it } from "vitest";
import {
  defaultSearchOccupancyUtcDay,
  occupancyForReservedFromSearchParams,
} from "../src/booking-search-exclusion.js";

describe("occupancyForReservedFromSearchParams", () => {
  it("prefers explicit occupancy overlap", () => {
    expect(
      occupancyForReservedFromSearchParams(
        { start: "2026-08-01", end: "2026-08-31" },
        "2026-06-01",
      ),
    ).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("falls back to availableFrom single day when no occupancy", () => {
    expect(occupancyForReservedFromSearchParams(null, "2026-06-15")).toEqual({
      start: "2026-06-15",
      end: "2026-06-15",
    });
  });

  it("returns null when neither overlap nor valid availableFrom", () => {
    expect(occupancyForReservedFromSearchParams(null, null)).toBeNull();
    expect(occupancyForReservedFromSearchParams(null, "not-a-date")).toBeNull();
  });

  it("defaultSearchOccupancyUtcDay returns YYYY-MM-DD pair", () => {
    const d = defaultSearchOccupancyUtcDay();
    expect(d.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.end).toBe(d.start);
  });
});
