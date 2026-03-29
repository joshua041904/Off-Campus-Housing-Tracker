import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { httpCounter, register, createHttpConcurrencyGuard } from "@common/utils";
import { pool } from "./db.js";

type AuthedRequest = Request & { userId?: string };

function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  req.userId = userId;
  next();
}

export function createNotificationHttpApp(): Application {
  const app = express();
  app.use(express.json({ limit: "512kb" }));
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({ service: "notification", route: req.path, method: req.method, code: res.statusCode })
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    if (!pool) {
      res.json({ ok: true, db: "skipped", warning: "POSTGRES_URL_NOTIFICATION unset" });
      return;
    }
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

  /** Internal: cron-jobs / ops ping (no auth). */
  app.post("/internal/cron/heartbeat", async (_req, res) => {
    res.json({ ok: true, at: new Date().toISOString() });
  });

  app.use(
    createHttpConcurrencyGuard({
      envVar: "NOTIFICATION_HTTP_MAX_CONCURRENT",
      defaultMax: 60,
      serviceLabel: "notification-service",
    }),
  );

  app.get("/preferences", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    try {
      const r = await pool.query(
        `SELECT email_enabled, sms_enabled, push_enabled, booking_alerts, message_alerts, moderation_alerts
         FROM notification.user_preferences WHERE user_id = $1::uuid`,
        [req.userId]
      );
      if (!r.rows.length) {
        return res.json({
          user_id: req.userId,
          email_enabled: true,
          sms_enabled: false,
          push_enabled: true,
          booking_alerts: true,
          message_alerts: true,
          moderation_alerts: true,
        });
      }
      const row = r.rows[0];
      res.json({
        user_id: req.userId,
        email_enabled: row.email_enabled,
        sms_enabled: row.sms_enabled,
        push_enabled: row.push_enabled,
        booking_alerts: row.booking_alerts,
        message_alerts: row.message_alerts,
        moderation_alerts: row.moderation_alerts,
      });
    } catch (e) {
      console.error("[preferences get]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.put("/preferences", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const b = req.body || {};
    try {
      await pool.query(
        `INSERT INTO notification.user_preferences
          (user_id, email_enabled, sms_enabled, push_enabled, booking_alerts, message_alerts, moderation_alerts)
         VALUES ($1::uuid, COALESCE($2, true), COALESCE($3, false), COALESCE($4, true), COALESCE($5, true), COALESCE($6, true), COALESCE($7, true))
         ON CONFLICT (user_id) DO UPDATE SET
           email_enabled = COALESCE(EXCLUDED.email_enabled, notification.user_preferences.email_enabled),
           sms_enabled = COALESCE(EXCLUDED.sms_enabled, notification.user_preferences.sms_enabled),
           push_enabled = COALESCE(EXCLUDED.push_enabled, notification.user_preferences.push_enabled),
           booking_alerts = COALESCE(EXCLUDED.booking_alerts, notification.user_preferences.booking_alerts),
           message_alerts = COALESCE(EXCLUDED.message_alerts, notification.user_preferences.message_alerts),
           moderation_alerts = COALESCE(EXCLUDED.moderation_alerts, notification.user_preferences.moderation_alerts),
           updated_at = now()`,
        [
          req.userId,
          b.email_enabled,
          b.sms_enabled,
          b.push_enabled,
          b.booking_alerts,
          b.message_alerts,
          b.moderation_alerts,
        ]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error("[preferences put]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/notifications", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    try {
      const r = await pool.query(
        `SELECT id, event_type, channel::text, status::text, payload, created_at
         FROM notification.notifications WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
        [req.userId, limit]
      );
      res.json({ items: r.rows });
    } catch (e) {
      console.error("[notifications list]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startNotificationHttpServer(port: number): void {
  const app = createNotificationHttpApp();
  app.listen(port, "0.0.0.0", () => console.log(`[notification HTTP] listening on ${port}`));
}
