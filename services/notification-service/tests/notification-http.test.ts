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
  if (norm.includes("FROM notification.notifications")) {
    return {
      rows: [
        {
          id: randomUUID(),
          event_type: "BookingCreatedV1",
          channel: "email",
          status: "pending",
          payload: {},
          created_at: new Date(),
        },
      ],
    };
  }
  return { rows: [] };
}

describe("createNotificationHttpApp (mocked pool)", () => {
  let app: Application;

  beforeAll(async () => {
    const mod = await import("../src/http-server.js");
    app = mod.createNotificationHttpApp();
  });

  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => defaultPool(sql));
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
    const args = poolQuery.mock.calls.find((c) => String(c[0]).includes("notification.notifications"));
    expect(args?.[1]).toEqual([userId, 200]);
  });

  it("GET /notifications — 500 on failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const res = await request(app).get("/notifications").set("x-user-id", userId);
    expect(res.status).toBe(500);
  });
});
