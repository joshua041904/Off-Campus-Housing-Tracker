import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { markBookingContextRead } from "../src/mark-booking-context-read.js";

describe("markBookingContextRead duplicate rows", () => {
  it("marks rows matched by booking_id, deep_link, and dedupe_key", async () => {
    const userId = randomUUID();
    const bookingId = randomUUID();
    const idContext = randomUUID();
    const idDeepLink = randomUUID();
    const query = vi.fn(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return {
          rows: [
            { id: idContext, booking_id_text: bookingId, read_at: "2026-05-16T00:00:00.000Z" },
            { id: idDeepLink, booking_id_text: bookingId, read_at: "2026-05-16T00:00:00.000Z" },
          ],
        };
      }
      if (norm.includes("SELECT n.id::text AS id, n.read_at")) {
        return {
          rows: [
            { id: idContext, read_at: "2026-05-16T00:00:00.000Z" },
            { id: idDeepLink, read_at: "2026-05-16T00:00:00.000Z" },
          ],
        };
      }
      return { rows: [] };
    });
    const pool = { query } as unknown as Pool;

    const result = await markBookingContextRead(pool, { userId, bookingId });

    expect(result.updated).toBe(2);
    expect(result.notification_ids).toEqual([idContext, idDeepLink]);
    expect(result.affected_rows).toBe(2);
    const updateSql = String(query.mock.calls.find((c) => String(c[0]).includes("UPDATE notification"))?.[0] || "");
    expect(updateSql).toContain("dedupe_key");
    expect(updateSql).toContain("deep_link");
    expect(updateSql).toContain("payload::text");
  });

  it("matches rows where booking id appears only in payload::text", async () => {
    const userId = randomUUID();
    const bookingId = randomUUID();
    const idTextOnly = randomUUID();
    const query = vi.fn(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return {
          rows: [{ id: idTextOnly, booking_id_text: bookingId, read_at: "2026-05-16T00:00:00.000Z" }],
        };
      }
      if (norm.startsWith("SELECT n.id::text AS id, n.read_at")) {
        return { rows: [{ id: idTextOnly, read_at: "2026-05-16T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });
    const pool = { query } as unknown as Pool;

    const result = await markBookingContextRead(pool, { userId, bookingId });

    expect(result.updated).toBe(1);
    const seedSql = String(query.mock.calls.find((c) => String(c[0]).includes("WITH seed AS"))?.[0] || "");
    expect(seedSql).toContain("payload::text");
  });
});
