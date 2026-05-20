/**
 * Structural HTTP tests for createNotificationHttpApp() with mocked pg pool + metrics.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "express";

const userId = randomUUID();

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
  },
}));

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    httpCounter: { inc: vi.fn() },
    register: {
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      metrics: vi.fn().mockResolvedValue("# notification test metrics\n"),
    },
    createHttpConcurrencyGuard: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("@common/utils/otel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils/otel")>();
  return {
    ...actual,
    tracingMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    mountDebugTraceHeaders: () => {},
    inferNetProtoForSpan: () => "http",
  };
});

const publishRealtime = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../src/realtime-publisher.js", () => ({
  publishRealtimeNotification: (...args: unknown[]) => publishRealtime(...args),
}));

const invalidateNotificationListCacheForUser = vi.hoisted(() => vi.fn().mockResolvedValue(2));
vi.mock("../src/notification-list-cache.js", () => ({
  getCachedNotificationList: vi.fn().mockResolvedValue(null),
  setCachedNotificationList: vi.fn().mockResolvedValue(undefined),
  invalidateNotificationListCacheForUser: (...args: unknown[]) =>
    invalidateNotificationListCacheForUser(...args),
  notificationListCacheHeaders: () => ({ "X-OCH-Cache": "miss" }),
}));

function defaultPool(sql: string): { rows: unknown[]; rowCount?: number } {
  const norm = sql.replace(/\s+/g, " ").trim();
  if (norm === "SELECT 1") {
    return { rows: [{ "?column?": 1 }], rowCount: 1 };
  }
  if (norm.includes("FROM notification.user_preferences")) {
    return {
      rows: [
        {
          email_enabled: true,
          sms_enabled: true,
          push_enabled: false,
          booking_alerts: true,
          message_alerts: false,
          moderation_alerts: true,
        },
      ],
    };
  }
  if (norm.includes("INSERT INTO notification.user_preferences")) {
    return { rows: [], rowCount: 1 };
  }
  if (norm.includes("COUNT(*)") && norm.includes("read_at IS NULL")) {
    return { rows: [{ unread_count: 2 }] };
  }
  if (norm.startsWith("SELECT id, user_id, read_at FROM notification.notifications WHERE id = $1::uuid")) {
    return { rows: [{ id: randomUUID(), user_id: userId, read_at: null }], rowCount: 1 };
  }
  if (norm.startsWith("SELECT id, read_at FROM notification.notifications WHERE id = $1::uuid AND user_id = $2::uuid")) {
    return { rows: [{ id: randomUUID(), read_at: new Date() }], rowCount: 1 };
  }
  if (norm.includes("UPDATE notification.notifications") && norm.includes("read_at")) {
    return { rows: [{ id: randomUUID(), read_at: new Date() }], rowCount: 1 };
  }
  if (norm.includes("FROM notification.notifications") && norm.includes("ORDER BY")) {
    return {
      rows: [
        {
          id: randomUUID(),
          user_id: userId,
          event_type: "BookingCreatedV1",
          channel: "email",
          status: "pending",
          payload: {},
          created_at: new Date(),
          read_at: null,
          dedupe_key: null,
        },
      ],
    };
  }
  return { rows: [] };
}

describe("createNotificationHttpApp (mocked pool)", () => {
  let app: Application;

  beforeAll(async () => {
    process.env.BOOKING_LISTINGS_INTERNAL_SECRET = "mesh-test-secret";
    const mod = await import("../src/http-server.js");
    app = mod.createNotificationHttpApp();
  });

  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => defaultPool(sql));
    publishRealtime.mockClear();
  });

  it("GET /healthz — connected", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: "connected" });
  });

  it("GET /healthz — disconnected on DB error", async () => {
    poolQuery.mockRejectedValueOnce(new Error("econnrefused"));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: "disconnected" });
  });

  it("GET /metrics — exposition", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(String(res.text)).toContain("notification test metrics");
  });

  it("POST /internal/cron/heartbeat — 200", async () => {
    const res = await request(app).post("/internal/cron/heartbeat").send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /preferences — 401 without x-user-id", async () => {
    const res = await request(app).get("/preferences");
    expect(res.status).toBe(401);
  });

  it("GET /preferences — 200 defaults when no row", async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("FROM notification.user_preferences")) {
        return { rows: [] };
      }
      return defaultPool(sql);
    });
    const res = await request(app).get("/preferences").set("x-user-id", userId);
    expect(res.status).toBe(200);
    expect(res.body.email_enabled).toBe(true);
    expect(res.body.sms_enabled).toBe(false);
    expect(res.body.user_id).toBe(userId);
  });

  it("GET /preferences — 200 with stored row", async () => {
    const res = await request(app).get("/preferences").set("x-user-id", userId);
    expect(res.status).toBe(200);
    expect(res.body.push_enabled).toBe(false);
    expect(res.body.message_alerts).toBe(false);
  });

  it("GET /preferences — 500 on query failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const res = await request(app).get("/preferences").set("x-user-id", userId);
    expect(res.status).toBe(500);
  });

  it("PUT /preferences — 401", async () => {
    const res = await request(app).put("/preferences").send({ email_enabled: false });
    expect(res.status).toBe(401);
  });

  it("PUT /preferences — 200", async () => {
    const res = await request(app).put("/preferences").set("x-user-id", userId).send({ email_enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PUT /preferences — 500 on failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const res = await request(app).put("/preferences").set("x-user-id", userId).send({});
    expect(res.status).toBe(500);
  });

  it("GET /notifications — 401", async () => {
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(401);
  });

  it("GET /notifications — 200 with items", async () => {
    const res = await request(app).get("/notifications").set("x-user-id", userId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
  });

  it("GET /notifications — respects limit cap", async () => {
    const res = await request(app).get("/notifications?limit=999").set("x-user-id", userId);
    expect(res.status).toBe(200);
    expect(poolQuery).toHaveBeenCalled();
    const listCall = poolQuery.mock.calls.find(
      (c) => String(c[0]).includes("notification.notifications") && String(c[0]).includes("LIMIT $"),
    );
    expect(listCall?.[1]).toEqual(expect.arrayContaining([userId, 200]));
  });

  it("GET /notifications — 500 on failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const res = await request(app).get("/notifications").set("x-user-id", userId);
    expect(res.status).toBe(500);
  });

  it("GET /notifications — filters by event_types", async () => {
    const res = await request(app)
      .get(`/notifications?limit=10&event_types=booking.created,booking.accepted`)
      .set("x-user-id", userId);
    expect(res.status).toBe(200);
    const args = poolQuery.mock.calls.find((c) => String(c[0]).includes("event_type = ANY"));
    expect(args?.[1]).toEqual([userId, ["booking.created", "booking.accepted"], 10]);
  });

  it("GET /notifications/unread-count — 200", async () => {
    const bookingId = randomUUID();
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("FROM notification.notifications n") && !norm.includes("LIMIT 25")) {
        return {
          rows: [
            {
              id: randomUUID(),
              event_type: "booking.confirmed",
              payload: { booking_id: bookingId },
              read_at: null,
            },
            {
              id: randomUUID(),
              event_type: "booking.cancelled",
              payload: { booking_id: bookingId },
              read_at: null,
            },
          ],
        };
      }
      return defaultPool(sql);
    });
    const res = await request(app).get("/notifications/unread-count?scope=landlord").set("x-user-id", userId);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(1);
  });

  it("POST /notifications/:id/read — 400 bad id", async () => {
    const res = await request(app).post("/notifications/not-a-uuid/read").set("x-user-id", userId);
    expect(res.status).toBe(400);
  });

  it("POST /notifications/:id/read — 200", async () => {
    const nid = randomUUID();
    const res = await request(app).post(`/notifications/${nid}/read`).set("x-user-id", userId);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.notification_id).toBeTruthy();
    expect(res.body.affected_rows).toBe(1);
  });

  it("POST /notifications/:id/read — logs when notification is missing", async () => {
    const nid = randomUUID();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.startsWith("SELECT id, user_id, read_at FROM notification.notifications WHERE id = $1::uuid")) {
        return { rows: [], rowCount: 0 };
      }
      return defaultPool(sql);
    });

    const res = await request(app).post(`/notifications/${nid}/read`).set("x-user-id", userId);

    expect(res.status).toBe(404);
    expect(warnSpy).toHaveBeenCalledWith("[notifications mark read] notification id not found", {
      notificationId: nid.toLowerCase(),
      userId,
    });
    warnSpy.mockRestore();
  });

  it("POST /notifications/:id/read — logs when notification belongs to another user", async () => {
    const nid = randomUUID();
    const otherUserId = randomUUID();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.startsWith("SELECT id, user_id, read_at FROM notification.notifications WHERE id = $1::uuid")) {
        return { rows: [{ id: nid, user_id: otherUserId, read_at: null }], rowCount: 1 };
      }
      return defaultPool(sql);
    });

    const res = await request(app).post(`/notifications/${nid}/read`).set("x-user-id", userId);

    expect(res.status).toBe(404);
    expect(warnSpy).toHaveBeenCalledWith("[notifications mark read] notification belongs to another user", {
      notificationId: nid.toLowerCase(),
      ownerUserId: otherUserId.toLowerCase(),
      userId,
    });
    warnSpy.mockRestore();
  });

  it("POST /notifications/:id/read — returns existing read_at when update affects 0 rows", async () => {
    const nid = randomUUID();
    const existingReadAt = "2026-05-14T01:23:45.000Z";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.startsWith("SELECT id, user_id, read_at FROM notification.notifications WHERE id = $1::uuid")) {
        return { rows: [{ id: nid, user_id: userId, read_at: existingReadAt }], rowCount: 1 };
      }
      if (norm.startsWith("UPDATE notification.notifications")) {
        return { rows: [], rowCount: 0 };
      }
      if (
        norm.startsWith(
          "SELECT id, read_at FROM notification.notifications WHERE id = $1::uuid AND user_id = $2::uuid",
        )
      ) {
        return { rows: [{ id: nid, read_at: existingReadAt }], rowCount: 1 };
      }
      return defaultPool(sql);
    });

    const res = await request(app).post(`/notifications/${nid}/read`).set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, notification_id: nid, read_at: existingReadAt, affected_rows: 0 });
    expect(warnSpy).toHaveBeenCalledWith("[notifications mark read] update affected 0 rows", {
      notificationId: nid.toLowerCase(),
      userId,
      affectedRows: 0,
      readAt: existingReadAt,
      reason: "already_read",
    });
    warnSpy.mockRestore();
  });

  it("POST /notifications/mark-context-read — 400 without booking context", async () => {
    const res = await request(app)
      .post("/notifications/mark-context-read")
      .set("x-user-id", userId)
      .send({ context_type: "booking" });

    expect(res.status).toBe(400);
  });

  it("POST /notifications/mark-context-read — marks unread booking rows for the current user", async () => {
    const bookingId = randomUUID();
    const idA = randomUUID();
    const idB = randomUUID();
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return {
          rows: [
            { id: idA, booking_id_text: bookingId.toLowerCase(), read_at: "2026-05-16T00:00:00.000Z" },
            { id: idB, booking_id_text: bookingId.toLowerCase(), read_at: "2026-05-16T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      if (norm.includes("SELECT n.id::text AS id, n.read_at")) {
        return {
          rows: [
            { id: idA, read_at: "2026-05-16T00:00:00.000Z" },
            { id: idB, read_at: "2026-05-16T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      return defaultPool(sql);
    });

    const res = await request(app)
      .post("/notifications/mark-context-read")
      .set("x-user-id", userId)
      .send({ context_type: "booking", booking_id: bookingId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      updated: 2,
      affected_rows: 2,
      context_type: "booking",
      booking_id: bookingId.toLowerCase(),
    });
    expect(res.body.notification_ids).toEqual([idA, idB]);
  });

  it("POST /notifications/mark-context-read — marks two duplicate rows and returns all ids", async () => {
    const bookingId = randomUUID();
    const idA = randomUUID();
    const idB = randomUUID();
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return {
          rows: [
            { id: idA, booking_id_text: bookingId.toLowerCase(), read_at: "2026-05-16T00:00:00.000Z" },
            { id: idB, booking_id_text: bookingId.toLowerCase(), read_at: "2026-05-16T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      if (norm.includes("SELECT n.id::text AS id, n.read_at") && !norm.includes("event_type")) {
        return {
          rows: [
            { id: idA, read_at: "2026-05-16T00:00:00.000Z" },
            { id: idB, read_at: "2026-05-16T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      return defaultPool(sql);
    });

    const res = await request(app)
      .post("/notifications/mark-context-read")
      .set("x-user-id", userId)
      .send({ context_type: "booking", booking_id: bookingId });

    expect(res.status).toBe(200);
    expect(res.body.affected_rows).toBe(2);
    expect(res.body.notification_ids).toEqual([idA, idB]);
    expect(invalidateNotificationListCacheForUser).toHaveBeenCalledWith(userId);
  });

  it("POST /notifications/mark-context-read — logs a reason when nothing was updated", async () => {
    const bookingId = randomUUID();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return { rows: [], rowCount: 0 };
      }
      if (norm.startsWith("SELECT id, ") && norm.includes("booking_id_text")) {
        return { rows: [{ id: randomUUID(), booking_id_text: bookingId.toLowerCase() }], rowCount: 1 };
      }
      return defaultPool(sql);
    });

    const res = await request(app)
      .post("/notifications/mark-context-read")
      .set("x-user-id", userId)
      .send({ context_type: "booking", booking_id: bookingId });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, updated: 0, context_type: "booking", booking_id: bookingId.toLowerCase() });
    expect(warnSpy).toHaveBeenCalledWith(
      "[notifications mark context read] update affected 0 rows",
      expect.objectContaining({
        userId,
        bookingId: bookingId.toLowerCase(),
      }),
    );
    warnSpy.mockRestore();
  });

  it("POST /notifications/mark-context-read — matches legacy bookingID and deep_link-only rows", async () => {
    const bookingId = randomUUID();
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WITH seed AS")) {
        return {
          rows: [
            { id: randomUUID(), booking_id_text: bookingId.toLowerCase(), read_at: "2026-05-16T00:00:00.000Z" },
            { id: randomUUID(), booking_id_text: bookingId.toLowerCase(), read_at: "2026-05-16T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      if (norm.includes("SELECT n.id::text AS id, n.read_at")) {
        return {
          rows: [
            { id: randomUUID(), read_at: "2026-05-16T00:00:00.000Z" },
            { id: randomUUID(), read_at: "2026-05-16T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      return defaultPool(sql);
    });

    const res = await request(app)
      .post("/notifications/mark-context-read")
      .set("x-user-id", userId)
      .send({ context_type: "booking", booking_id: bookingId });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
  });

  it("POST /internal/push-notification — booking.created stores frontend-ready payload", async () => {
    const landlord = randomUUID();
    const bookingId = randomUUID();
    const listingId = randomUUID();
    const tenantId = randomUUID();
    let insertedPayload: Record<string, unknown> | null = null;
    poolQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.startsWith("SELECT 1 AS ok") && norm.includes("event_type = 'booking.created'")) {
        return { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO notification.notifications")) {
        insertedPayload = JSON.parse(String((params as unknown[])?.[2] ?? "{}")) as Record<string, unknown>;
        return { rows: [], rowCount: 1 };
      }
      return defaultPool(sql);
    });

    const res = await request(app)
      .post("/internal/push-notification")
      .set("x-booking-internal-secret", "mesh-test-secret")
      .send({
        user_id: landlord,
        event_type: "booking.created",
        payload: {
          booking_id: bookingId,
          listing_id: listingId,
          listing_title: "2 room apt",
          tenant_id: tenantId,
          tenant_username: "booker123",
          tenant_username_snapshot: "booker123_507ab69b2d",
          tenant_display_name: "Booker 123",
          tenant_email: "booker@example.com",
          booking_status: "PENDING",
          start_date: "2026-08-15",
          end_date: "2026-12-20",
          deep_link: `/dashboard/bookings/${bookingId}`,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(true);
    expect(insertedPayload).not.toBeNull();
    expect(insertedPayload).toMatchObject({
      booking_id: bookingId,
      listing_id: listingId,
      listing_title: "2 room apt",
      tenant_id: tenantId,
      tenant_username: "booker123",
      tenant_username_snapshot: "booker123_507ab69b2d",
      tenant_display_name: "Booker 123",
      tenant_email: "booker@example.com",
      booking_status: "PENDING",
      start_date: "2026-08-15",
      end_date: "2026-12-20",
      deep_link: `/dashboard/bookings/${bookingId}`,
    });
    expect(publishRealtime).toHaveBeenCalledWith(
      landlord,
      expect.objectContaining({
        event_type: "booking.created",
        booking_id: bookingId,
        tenant_username: "booker123",
        tenant_username_snapshot: "booker123_507ab69b2d",
        tenant_display_name: "Booker 123",
        booking_status: "PENDING",
      }),
    );
  });

  it("GET /notifications after context read — sibling rows normalized and unread-count 0 on fresh request", async () => {
    const bookingId = randomUUID();
    const readAt = "2026-05-16T12:00:00.000Z";
    poolQuery.mockImplementation(async (sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("sync_booking_context") || (norm.includes("UPDATE notification.notifications") && norm.includes("read_at"))) {
        return { rows: [], rowCount: 0 };
      }
      if (norm.includes("COUNT(*)") && norm.includes("read_at IS NULL")) {
        return { rows: [{ unread_count: 0 }] };
      }
      if (norm.includes("FROM notification.notifications") && norm.includes("ORDER BY")) {
        return {
          rows: [
            {
              id: randomUUID(),
              user_id: userId,
              event_type: "booking.confirmed",
              channel: "push",
              status: "pending",
              payload: { booking_id: bookingId, category: "booking" },
              created_at: new Date("2026-05-15T04:02:37.899Z"),
              read_at: readAt,
              dedupe_key: null,
              context_id: bookingId,
            },
            {
              id: randomUUID(),
              user_id: userId,
              event_type: "booking.cancelled",
              channel: "push",
              status: "pending",
              payload: { booking_id: bookingId, category: "booking" },
              created_at: new Date("2026-05-14T00:00:00.000Z"),
              read_at: null,
              dedupe_key: null,
              context_id: bookingId,
            },
          ],
        };
      }
      return defaultPool(sql);
    });

    const listRes = await request(app).get("/notifications?scope=landlord").set("x-user-id", userId);
    expect(listRes.status).toBe(200);
    expect(
      (listRes.body.items as Array<{ read_at?: string | null }>).every((row) => Boolean(row.read_at)),
    ).toBe(true);

    const countRes = await request(app)
      .get("/notifications/unread-count?scope=landlord")
      .set("x-user-id", userId);
    expect(countRes.status).toBe(200);
    expect(countRes.body.unreadCount).toBe(0);
  });

  it("POST /internal/push-notification — booking.accepted inserts + realtime", async () => {
    const tenant = randomUUID();
    const bid = randomUUID();
    const nid = randomUUID();
    poolQuery.mockImplementation(async (sql: string) => {
      const n = sql.replace(/\s+/g, " ").trim();
      if (n.startsWith("SELECT id::text") && n.includes("booking.accepted")) {
        return { rows: [], rowCount: 0 };
      }
      if (n.includes("INSERT INTO notification.notifications") && n.includes("RETURNING")) {
        return { rows: [{ id: nid }], rowCount: 1 };
      }
      return defaultPool(sql);
    });
    const res = await request(app)
      .post("/internal/push-notification")
      .set("x-booking-internal-secret", "mesh-test-secret")
      .send({
        user_id: tenant,
        event_type: "booking.accepted",
        payload: {
          bookingId: bid,
          listingId: randomUUID(),
          landlordId: randomUUID(),
          tenantId: tenant,
          previousStatus: "PENDING",
          listingTitle: "Test listing",
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(true);
    expect(res.body.notification_id).toBe(nid);
    expect(publishRealtime).toHaveBeenCalled();
  });
});
