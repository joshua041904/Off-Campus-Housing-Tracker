import express, { type NextFunction, type Request, type Response } from "express";
import { httpCounter, register } from "@common/utils";
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

export function createTrustHttpApp() {
  const app = express();
  app.use(express.json({ limit: "512kb" }));
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({ service: "trust", route: req.path, method: req.method, code: res.statusCode })
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

  app.post("/report-abuse", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const t = String(req.body?.abuse_target_type || "").toLowerCase();
      const targetId = String(req.body?.target_id || "").trim();
      const category = String(req.body?.category || "abuse").trim();
      const details = String(req.body?.details || "").trim();
      if (!targetId || (t !== "listing" && t !== "user")) {
        res.status(400).json({ error: "abuse_target_type listing|user and target_id required" });
        return;
      }
      if (t === "listing") {
        const r = await pool.query(
          `INSERT INTO trust.listing_flags (listing_id, reporter_id, reason, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
          [targetId, req.userId, category, details || null]
        );
        res.status(201).json({ flag_id: r.rows[0].id, status: r.rows[0].status });
      } else {
        const r = await pool.query(
          `INSERT INTO trust.user_flags (user_id, reporter_id, reason, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
          [targetId, req.userId, category, details || null]
        );
        res.status(201).json({ flag_id: r.rows[0].id, status: r.rows[0].status });
      }
    } catch (e) {
      console.error("[report-abuse]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/peer-review", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bookingId = String(req.body?.booking_id || "").trim();
      const revieweeId = String(req.body?.reviewee_id || "").trim();
      const side = String(req.body?.side || "").trim();
      const rating = Number(req.body?.rating);
      const comment = String(req.body?.comment || "");
      if (!bookingId || !revieweeId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        res.status(400).json({ error: "booking_id, reviewee_id, rating 1-5 required" });
        return;
      }
      const meta = `[${side}] ${comment}`.slice(0, 4000);
      const r = await pool.query(
        `INSERT INTO trust.reviews (booking_id, reviewer_id, target_type, target_id, rating, comment)
         VALUES ($1::uuid, $2::uuid, 'user'::trust.review_target_type, $3::uuid, $4, $5) RETURNING id`,
        [bookingId, req.userId, revieweeId, rating, meta || null]
      );
      res.status(201).json({ review_id: r.rows[0].id });
    } catch (e: any) {
      if (String(e?.message || "").includes("unique") || e?.code === "23505") {
        res.status(409).json({ error: "duplicate review" });
        return;
      }
      console.error("[peer-review]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/reputation/:userId", async (req, res) => {
    try {
      const uid = String(req.params.userId || "").trim();
      if (!uid) {
        res.status(400).json({ error: "user_id required" });
        return;
      }
      const r = await pool.query(`SELECT reputation_score FROM trust.reputation WHERE user_id = $1::uuid`, [uid]);
      const score = r.rows[0] ? Number(r.rows[0].reputation_score) || 0 : 0;
      res.json({ user_id: uid, score });
    } catch (e) {
      console.error("[reputation]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startTrustHttpServer(port: number): void {
  const app = createTrustHttpApp();
  app.listen(port, "0.0.0.0", () => console.log(`[trust HTTP] listening on ${port}`));
}
