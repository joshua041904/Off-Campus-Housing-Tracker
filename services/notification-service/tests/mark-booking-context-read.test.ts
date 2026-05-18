import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { markBookingContextRead } from "../src/mark-booking-context-read.js";

describe("markBookingContextRead", () => {
  it("marks duplicate rows when only notification_id is provided", async () => {
    const userId = randomUUID();
    const bookingId = randomUUID();
    const idA = randomUUID();
    const idB = randomUUID();
    const query = vi.fn(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return {
          rows: [
            { id: idA, booking_id_text: bookingId, read_at: "2026-05-16T00:00:00.000Z" },
            { id: idB, booking_id_text: bookingId, read_at: "2026-05-16T00:00:00.000Z" },
          ],
        };
      }
      if (norm.includes("SELECT n.id::text AS id, n.read_at")) {
        return {
          rows: [
            { id: idA, read_at: "2026-05-16T00:00:00.000Z" },
            { id: idB, read_at: "2026-05-16T00:00:00.000Z" },
          ],
        };
      }
      return { rows: [] };
    });
    const pool = { query } as unknown as Pool;

    const result = await markBookingContextRead(pool, {
      userId,
      notificationId: idA,
    });

    expect(result.updated).toBe(2);
    expect(result.affected_rows).toBe(2);
    expect(result.notification_ids).toEqual([idA, idB]);
    expect(result.booking_id).toBe(bookingId);
  });
});
