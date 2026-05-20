import { describe, expect, it, vi } from "vitest";
import { peerReviewEligibleBookingIdSet } from "../src/review-booking-eligibility.js";

describe("peerReviewEligibleBookingIdSet", () => {
  it("includes pending_confirmation, confirmed, completed", async () => {
    const poolQuery = vi.fn().mockResolvedValue({
      rows: [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending_confirmation" },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "confirmed" },
        { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "completed" },
      ],
    });
    const pool = { query: poolQuery } as import("pg").Pool;
    const ids = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ];
    const ok = await peerReviewEligibleBookingIdSet(pool, ids);
    expect(Array.from(ok).sort()).toEqual(ids.slice().sort());
  });

  it("excludes created and rejected", async () => {
    const poolQuery = vi.fn().mockResolvedValue({
      rows: [
        { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "created" },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "rejected" },
      ],
    });
    const pool = { query: poolQuery } as import("pg").Pool;
    const ok = await peerReviewEligibleBookingIdSet(pool, [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
    expect(ok.size).toBe(0);
  });

  it("includes booking ids not returned by booking DB (cross-env / missing row)", async () => {
    const poolQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: poolQuery } as import("pg").Pool;
    const orphan = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const ok = await peerReviewEligibleBookingIdSet(pool, [orphan]);
    expect(ok.has(orphan)).toBe(true);
  });
});
