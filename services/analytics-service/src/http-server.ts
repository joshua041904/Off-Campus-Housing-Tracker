import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { httpCounter, register, createHttpConcurrencyGuard } from "@common/utils";
import { pool } from "./db.js";
import { bookingReadPool } from "./booking-read-pool.js";
import { analyzeListingFeelText } from "./ollama.js";
import { applyListingCreatedForAnalytics } from "./listing-metrics-projection.js";

type Authed = Request & { userId?: string };

function optionalUser(req: Authed, _res: Response, next: NextFunction) {
  const uid = (req.get("x-user-id") || "").trim();
  if (uid) req.userId = uid;
  next();
}

function requireSelfUser(req: Authed, res: Response, next: NextFunction) {
  const hdr = (req.get("x-user-id") || "").trim();
  const param = String((req.params as { userId?: string }).userId || "").trim();
  if (!hdr || !param || hdr !== param) {
    res.status(403).json({ error: "forbidden: x-user-id must match userId" });
    return;
  }
  req.userId = hdr;
  next();
}

function internalListingIngestGuard(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ANALYTICS_SYNC_MODE !== "1") {
    res.status(404).json({ error: "not found" });
    return;
  }
  const token = (process.env.ANALYTICS_INTERNAL_INGEST_TOKEN || "").trim();
  if (token && (req.get("x-internal-ingest-token") || "").trim() !== token) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

export function createAnalyticsHttpApp(): Application {
  const app = express();
  app.use(express.json({ limit: "512kb" }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const traceId = req.get("x-trace-id") || "none";
    const internalCall = req.get("x-internal-call") || "";
    if (req.path.startsWith("/internal/") || internalCall) {
      console.log(
        `[analytics-http] traceId=${traceId} x-internal-call=${internalCall} ${req.method} ${req.path}`,
      );
    }
    next();
  });
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({ service: "analytics", route: req.path, method: req.method, code: res.statusCode })
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: "connected" });
    } catch {
      res.json({ ok: true, db: "disconnected", warning: "database unavailable" });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  /**
   * Internal ingestion must run BEFORE the HTTP concurrency guard.
   * Listings-service sync posts here; counting it against ANALYTICS_HTTP_MAX_CONCURRENT can 503 under load
   * and drop events → daily_metrics never updates (E2E system-integrity).
   */
  app.post("/internal/ingest/listing-created", internalListingIngestGuard, async (req, res) => {
    const body = req.body as { event_id?: string; listed_at_day?: string };
    const eventId = String(body?.event_id || "").trim();
    const day = String(body?.listed_at_day || "").trim().slice(0, 10);
    if (!/^[0-9a-f-]{36}$/i.test(eventId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      res.status(400).json({ error: "event_id (uuid) and listed_at_day (YYYY-MM-DD) required" });
      return;
    }
    try {
      await applyListingCreatedForAnalytics(pool, eventId, day);
      res.status(204).end();
    } catch (e) {
      console.error("[internal/ingest/listing-created]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.use(
    createHttpConcurrencyGuard({
      envVar: "ANALYTICS_HTTP_MAX_CONCURRENT",
      defaultMax: 60,
      serviceLabel: "analytics-service",
    }),
  );

  /** Public aggregate read (gateway OPEN route). */
  app.get("/daily-metrics", async (req, res) => {
    try {
      const date = String(req.query.date || "").trim();
      if (!date) {
        res.status(400).json({ error: "date=YYYY-MM-DD required" });
        return;
      }
      const r = await pool.query(
        `SELECT date, new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged
         FROM analytics.daily_metrics WHERE date = $1::date`,
        [date]
      );
      if (!r.rows[0]) {
        res.json({
          date,
          new_users: 0,
          new_listings: 0,
          new_bookings: 0,
          completed_bookings: 0,
          messages_sent: 0,
          listings_flagged: 0,
        });
        return;
      }
      const row = r.rows[0];
      res.json({
        date: row.date,
        new_users: row.new_users,
        new_listings: row.new_listings,
        new_bookings: row.new_bookings,
        completed_bookings: row.completed_bookings,
        messages_sent: row.messages_sent ?? 0,
        listings_flagged: row.listings_flagged ?? 0,
      });
    } catch (e) {
      console.error("[daily-metrics]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/insights/watchlist/:userId", optionalUser, async (req: Authed, res) => {
    try {
      const uid = String(req.params.userId || "").trim();
      if (!uid) {
        res.status(400).json({ error: "user_id required" });
        return;
      }
      const r = await pool.query(
        `SELECT COALESCE(SUM(adds), 0)::int AS a, COALESCE(SUM(removes), 0)::int AS r
         FROM analytics.user_watchlist_daily
         WHERE user_id = $1::uuid AND day >= (CURRENT_DATE - INTERVAL '30 days')`,
        [uid]
      );
      res.json({
        user_id: uid,
        watchlist_adds_30d: r.rows[0]?.a ?? 0,
        watchlist_removes_30d: r.rows[0]?.r ?? 0,
        notes: "Projected from domain events; run infra/db/04-analytics-watchlist-engagement.sql and consumers.",
      });
    } catch (e) {
      console.error("[watchlist insights]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  /** Past housing searches (booking DB read-only when POSTGRES_URL_BOOKINGS is set on analytics pod). */
  app.get("/insights/search-summary/:userId", requireSelfUser, async (req: Authed, res) => {
    const uid = String(req.params.userId || "").trim();
    if (!bookingReadPool) {
      res.json({
        user_id: uid,
        items: [] as unknown[],
        hint: "Set POSTGRES_URL_BOOKINGS on analytics-service for search-history insights (read-only).",
      });
      return;
    }
    try {
      const r = await bookingReadPool.query(
        `SELECT query, min_price_cents, max_price_cents, max_distance_km, latitude, longitude, created_at
         FROM booking.search_history WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
        [uid]
      );
      res.json({
        user_id: uid,
        items: r.rows,
        notification_hook: "notification-service can consume dev.analytics.events for digest pushes (planned).",
      });
    } catch (e) {
      console.error("[search-summary]", e);
      res.status(500).json({ error: "booking read failed (check POSTGRES_URL_BOOKINGS and network)" });
    }
  });

  app.post("/insights/listing-feel", optionalUser, async (req: Authed, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const title = String(body.title || "");
      const description = String(body.description || "");
      const price_cents = Number(body.price_cents ?? 0);
      const audience = String(body.audience || "renter");
      if (!title || !Number.isFinite(price_cents)) {
        res.status(400).json({ error: "title and price_cents required" });
        return;
      }
      const out = await analyzeListingFeelText({ title, description, price_cents, audience });
      res.json(out);
    } catch (e) {
      console.error("[listing-feel]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startAnalyticsHttpServer(port: number): void {
  const app = createAnalyticsHttpApp();
  app.listen(port, "0.0.0.0", () => console.log(`[analytics HTTP] listening on ${port}`));
}
