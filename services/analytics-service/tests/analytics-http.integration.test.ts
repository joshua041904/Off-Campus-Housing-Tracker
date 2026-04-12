/**
 * Analytics HTTP + Postgres (5447). Uses `createAnalyticsHttpApp()` only — no Kafka consumer boot (Tier: DB HTTP surface).
 *
 *   pnpm --filter analytics-service run test:integration
 *
 * Skip: SKIP_ANALYTICS_INTEGRATION=1 or analytics schema missing.
 */
process.env.POSTGRES_URL_ANALYTICS ??=
  "postgresql://postgres:postgres@127.0.0.1:5447/analytics";
process.env.ANALYTICS_SYNC_MODE = "1";

import type { Express } from "express";
import pg from "pg";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const conn = process.env.POSTGRES_URL_ANALYTICS!;

async function analyticsSchemaReady(): Promise<boolean> {
  let client: pg.Client | undefined;
  try {
    client = new pg.Client({
      connectionString: conn,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    const { rows } = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM information_schema.tables
       WHERE table_schema = 'analytics' AND table_name = 'daily_metrics'`,
    );
    return rows[0]?.c === "1";
  } catch {
    return false;
  } finally {
    try {
      await client?.end();
    } catch {
      /* ignore */
    }
  }
}

async function hasWatchlistTable(): Promise<boolean> {
  let client: pg.Client | undefined;
  try {
    client = new pg.Client({
      connectionString: conn,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    const { rows } = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM information_schema.tables
       WHERE table_schema = 'analytics' AND table_name = 'user_watchlist_daily'`,
    );
    return rows[0]?.c === "1";
  } catch {
    return false;
  } finally {
    try {
      await client?.end();
    } catch {
      /* ignore */
    }
  }
}

async function resetDailyMetricForDate(date: string): Promise<void> {
  let client: pg.Client | undefined;
  try {
    client = new pg.Client({
      connectionString: conn,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    await client.query(
      `DELETE FROM analytics.daily_metrics WHERE date = $1::date`,
      [date],
    );
  } finally {
    try {
      await client?.end();
    } catch {
      /* ignore */
    }
  }
}

async function resetProcessedEvent(eventId: string): Promise<void> {
  let client: pg.Client | undefined;
  try {
    client = new pg.Client({
      connectionString: conn,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    await client.query(
      `DELETE FROM analytics.processed_events WHERE event_id = $1::uuid`,
      [eventId],
    );
  } finally {
    try {
      await client?.end();
    } catch {
      /* ignore */
    }
  }
}

const dbReady = await analyticsSchemaReady();
const watchlistTable = dbReady ? await hasWatchlistTable() : false;
const skip =
  process.env.SKIP_ANALYTICS_INTEGRATION === "1" ||
  process.env.SKIP_ANALYTICS_INTEGRATION === "true";

describe.skipIf(skip || !dbReady)(
  "analytics HTTP — integration surface",
  () => {
    let app: Express;

    beforeAll(async () => {
      const mod = await import("../src/http-server.js");
      app = mod.createAnalyticsHttpApp();
    });

    afterAll(async () => {
      const { pool } = await import("../src/db.js");
      await pool.end();
    });

    it("GET /healthz returns 200", async () => {
      const res = await request(app).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });

    it("GET /metrics returns Prometheus text", async () => {
      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      expect(String(res.headers["content-type"] || "")).toMatch(/text\/plain/);
      expect(res.text.length).toBeGreaterThan(0);
    });

    it("GET /daily-metrics?date= returns zeros or row for valid date", async () => {
      const res = await request(app)
        .get("/daily-metrics")
        .query({ date: "2099-12-31" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        date: "2099-12-31",
        new_users: expect.any(Number),
        new_listings: expect.any(Number),
        new_bookings: expect.any(Number),
        completed_bookings: expect.any(Number),
        messages_sent: expect.any(Number),
        listings_flagged: expect.any(Number),
      });
    });

    it("GET /daily-metrics without date → 400", async () => {
      const res = await request(app).get("/daily-metrics");
      expect(res.status).toBe(400);
    });

    it("POST /internal/ingest/listing-created increments daily_metrics.new_listings", async () => {
      const date = "2099-12-30";
      const eventId = randomUUID();

      await resetDailyMetricForDate(date);
      await resetProcessedEvent(eventId);

      const before = await request(app).get("/daily-metrics").query({ date });
      expect(before.status).toBe(200);
      expect(before.body.new_listings).toBe(0);

      const ingest = await request(app)
        .post("/internal/ingest/listing-created")
        .set("Content-Type", "application/json")
        .send({
          event_id: eventId,
          listed_at_day: date,
        });

      expect(ingest.status).toBe(204);

      const after = await request(app).get("/daily-metrics").query({ date });
      expect(after.status).toBe(200);
      expect(after.body.new_listings).toBe(1);
    });

    it("POST /internal/ingest/listing-created is idempotent for duplicate event_id", async () => {
      const date = "2099-12-29";
      const eventId = randomUUID();

      await resetDailyMetricForDate(date);
      await resetProcessedEvent(eventId);

      const first = await request(app)
        .post("/internal/ingest/listing-created")
        .set("Content-Type", "application/json")
        .send({
          event_id: eventId,
          listed_at_day: date,
        });

      expect(first.status).toBe(204);

      const second = await request(app)
        .post("/internal/ingest/listing-created")
        .set("Content-Type", "application/json")
        .send({
          event_id: eventId,
          listed_at_day: date,
        });

      expect(second.status).toBe(204);

      const finalMetrics = await request(app)
        .get("/daily-metrics")
        .query({ date });
      expect(finalMetrics.status).toBe(200);
      expect(finalMetrics.body.new_listings).toBe(1);
    });

    it("GET /insights/search-summary/:userId → 403 when x-user-id mismatch", async () => {
      const uid = randomUUID();
      const res = await request(app)
        .get(`/insights/search-summary/${uid}`)
        .set("x-user-id", randomUUID());
      expect(res.status).toBe(403);
    });

    it("GET /insights/search-summary/:userId → 200 with self x-user-id", async () => {
      const uid = randomUUID();
      const res = await request(app)
        .get(`/insights/search-summary/${uid}`)
        .set("x-user-id", uid);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        user_id: uid,
        items: expect.any(Array),
      });
    });

    it.skipIf(!watchlistTable)(
      "GET /insights/watchlist/:userId → 200",
      async () => {
        const uid = randomUUID();
        const res = await request(app).get(`/insights/watchlist/${uid}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          user_id: uid,
          watchlist_adds_30d: expect.any(Number),
          watchlist_removes_30d: expect.any(Number),
        });
      },
    );
  },
);
