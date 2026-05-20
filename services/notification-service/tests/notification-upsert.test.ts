import { describe, expect, it, vi } from "vitest";
import { upsertNotificationByDedupeKey } from "../src/notification-upsert.js";

function mockPool(seq: { rows: { id?: string; read_at?: string | null }[]; rowCount?: number }[]) {
  let i = 0;
  return {
    query: vi.fn(async () => {
      const n = seq[i] ?? { rows: [], rowCount: 0 };
      i += 1;
      return n;
    }),
  } as import("pg").Pool;
}

describe("upsertNotificationByDedupeKey", () => {
  it("inserts when no existing row", async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      { rows: [{ id: "nid-1", read_at: null }], rowCount: 1 },
    ]);
    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { booking_id: "b1" },
      dedupeKey: "k1",
    });
    expect(r.inserted).toBe(true);
    expect(r.notificationId).toBe("nid-1");
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("merges when row exists (no read_at reset)", async () => {
    const pool = mockPool([
      { rows: [{ id: "nid-1", read_at: "2020-01-01T00:00:00.000Z" }], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { extra: 1 },
      dedupeKey: "k1",
    });
    expect(r.inserted).toBe(false);
    expect(r.notificationId).toBe("nid-1");
    expect(r.readAt).toBe("2020-01-01T00:00:00.000Z");
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("on unique race after empty SELECT, merges and preserves read_at from row", async () => {
    const dup = Object.assign(new Error("duplicate key"), { code: "23505" });
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockRejectedValueOnce(dup)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: "nid-race", read_at: "2019-06-01T12:00:00.000Z" }],
          rowCount: 1,
        }),
    } as import("pg").Pool;
    const r = await upsertNotificationByDedupeKey(pool, {
      userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      eventType: "booking.created",
      payload: { from: "kafka" },
      dedupeKey: "race-key",
    });
    expect(r.inserted).toBe(false);
    expect(r.notificationId).toBe("nid-race");
    expect(r.readAt).toBe("2019-06-01T12:00:00.000Z");
    expect(pool.query).toHaveBeenCalledTimes(4);
  });
});
