import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();

describe("applyListingCreatedForAnalytics", () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  it("returns false for bad day", async () => {
    const { applyListingCreatedForAnalytics } = await import(
      "../src/listing-metrics-projection.js"
    );
    const pool = { query: poolQuery } as import("pg").Pool;
    await expect(
      applyListingCreatedForAnalytics(pool, randomUUID(), "bad-day"),
    ).resolves.toBe(false);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("returns false when claim fails", async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const { applyListingCreatedForAnalytics } = await import(
      "../src/listing-metrics-projection.js"
    );
    const pool = { query: poolQuery } as import("pg").Pool;
    const id = "00000000-0000-4000-8000-000000000099";
    await expect(
      applyListingCreatedForAnalytics(pool, id, "2026-01-10"),
    ).resolves.toBe(false);
  });

  it("bumps metrics when claim succeeds", async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { applyListingCreatedForAnalytics } = await import(
      "../src/listing-metrics-projection.js"
    );
    const pool = { query: poolQuery } as import("pg").Pool;
    const id = "00000000-0000-4000-8000-0000000000aa";
    await expect(
      applyListingCreatedForAnalytics(pool, id, "2026-01-11"),
    ).resolves.toBe(true);
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });
});
