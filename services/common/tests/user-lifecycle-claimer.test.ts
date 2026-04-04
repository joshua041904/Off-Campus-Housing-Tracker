import { describe, it, expect, vi } from "vitest";
import { makeLifecycleEventClaimer } from "../src/user-lifecycle-consumer.js";

describe("makeLifecycleEventClaimer", () => {
  it("returns true on first insert and false on duplicate event_id (idempotent skip)", async () => {
    const eventId = "550e8400-e29b-41d4-a716-446655440000";
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 0 }),
    };
    const claim = makeLifecycleEventClaimer(pool, "listings");
    expect(await claim(eventId)).toBe(true);
    expect(await claim(eventId)).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0]?.[0]).toContain("INSERT INTO listings.processed_events");
    expect(pool.query.mock.calls[0]?.[1]).toEqual([eventId]);
  });
});
