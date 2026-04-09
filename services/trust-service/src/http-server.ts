import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  httpCounter,
  register,
  createHttpConcurrencyGuard,
} from "@common/utils";
import { pool } from "./db.js";

type AuthedRequest = Request & { userId?: string };

// Logs per-request HTTP latency and marks requests over the configured threshold as slow.
function attachTrustHttpDiagnostics(app: ReturnType<typeof express>): void {
  const timingEnabled =
    process.env.TRUST_HTTP_TIMING === "1" ||
    process.env.TRUST_HTTP_TIMING === "true";
  const minMs = Number(process.env.TRUST_HTTP_TIMING_MIN_MS ?? "100");

  if (!timingEnabled) return;

  console.log(`[trust-http-timing] enabled minMs=${minMs}`);

  app.use((req, res, next) => {
    const started = Date.now();

    res.on("finish", () => {
      const ms = Date.now() - started;
      const path = req.originalUrl || req.url || req.path;
      const slow = ms > minMs;

      console.log(
        `[trust HTTP] ${slow ? "SLOW REQUEST " : ""}method=${req.method} path=${path} status=${res.statusCode} latency_ms=${ms}`,
      );
    });

    next();
  });
}

function sendOk(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

function sendErr(
  res: Response,
  status: number,
  message: string,
  code?: string,
): void {
  res.status(status).json(code ? { error: message, code } : { error: message });
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function requireUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    sendErr(res, 401, "missing x-user-id");
    return;
  }
  req.userId = userId;
  next();
}

export function createTrustHttpApp() {
  const app = express();
  app.use(express.json({ limit: "512kb" }));
  attachTrustHttpDiagnostics(app);
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "trust",
        route: req.path,
        method: req.method,
        code: res.statusCode,
      }),
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: "connected" });
    } catch {
      res.json({
        ok: true,
        db: "disconnected",
        warning: "database unavailable",
      });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  app.use(
    createHttpConcurrencyGuard({
      envVar: "TRUST_HTTP_MAX_CONCURRENT",
      defaultMax: 60,
      serviceLabel: "trust-service",
    }),
  );

  /** Same semantics as gRPC FlagListing — listing_id, reason; reporter from x-user-id */
  app.post(
    "/flag-listing",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const listingId = String(req.body?.listing_id || "").trim();
        const reason = String(req.body?.reason || "").trim();
        if (!listingId || !reason) {
          sendErr(res, 400, "listing_id and reason required");
          return;
        }
        // Validate UUIDs before DB access to avoid Postgres cast errors surfacing as 500s.
        if (!isValidUuid(listingId)) {
          sendErr(res, 400, "invalid listing_id", "INVALID_ID");
          return;
        }
        if (!req.userId || !isValidUuid(req.userId)) {
          sendErr(res, 400, "invalid reporter id", "INVALID_ID");
          return;
        }
        const r = await pool.query(
          `INSERT INTO trust.listing_flags (listing_id, reporter_id, reason) VALUES ($1::uuid, $2::uuid, $3) RETURNING id, status::text`,
          [listingId, req.userId, reason],
        );
        sendOk(res, { flag_id: r.rows[0].id, status: r.rows[0].status }, 201);
      } catch (e: any) {
        if (e?.code === "23505") {
          sendErr(res, 409, "duplicate flag");
          return;
        }
        console.error("[flag-listing]", e);
        sendErr(res, 500, "internal");
      }
    },
  );

  app.post(
    "/report-abuse",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const t = String(req.body?.abuse_target_type || "").toLowerCase();
        const targetId = String(req.body?.target_id || "").trim();
        const category = String(req.body?.category || "abuse").trim();
        const details = String(req.body?.details || "").trim();
        if (!targetId || (t !== "listing" && t !== "user")) {
          sendErr(
            res,
            400,
            "abuse_target_type listing|user and target_id required",
          );
          return;
        }
        // Validate UUIDs before DB access to avoid Postgres cast errors surfacing as 500s.
        if (!isValidUuid(targetId)) {
          sendErr(res, 400, "invalid target_id", "INVALID_ID");
          return;
        }
        if (!req.userId || !isValidUuid(req.userId)) {
          sendErr(res, 400, "invalid reporter id", "INVALID_ID");
          return;
        }
        if (t === "listing") {
          const r = await pool.query(
            `INSERT INTO trust.listing_flags (listing_id, reporter_id, reason, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
            [targetId, req.userId, category, details || null],
          );
          sendOk(res, { flag_id: r.rows[0].id, status: r.rows[0].status }, 201);
        } else {
          const r = await pool.query(
            `INSERT INTO trust.user_flags (user_id, reporter_id, reason, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
            [targetId, req.userId, category, details || null],
          );
          sendOk(res, { flag_id: r.rows[0].id, status: r.rows[0].status }, 201);
        }
      } catch (e: any) {
        if (e?.code === "23505") {
          sendErr(res, 409, "duplicate flag");
          return;
        }
        console.error("[report-abuse]", e);
        sendErr(res, 500, "internal");
      }
    },
  );

  app.post(
    "/peer-review",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const bookingId = String(req.body?.booking_id || "").trim();
        const revieweeId = String(req.body?.reviewee_id || "").trim();
        const side = String(req.body?.side || "").trim();
        const rating = Number(req.body?.rating);
        const comment = String(req.body?.comment || "");
        if (
          !bookingId ||
          !revieweeId ||
          !Number.isInteger(rating) ||
          rating < 1 ||
          rating > 5
        ) {
          sendErr(res, 400, "booking_id, reviewee_id, rating 1-5 required");
          return;
        }
        const meta = `[${side}] ${comment}`.slice(0, 4000);
        const r = await pool.query(
          `INSERT INTO trust.reviews (booking_id, reviewer_id, target_type, target_id, rating, comment)
         VALUES ($1::uuid, $2::uuid, 'user'::trust.review_target_type, $3::uuid, $4, $5) RETURNING id`,
          [bookingId, req.userId, revieweeId, rating, meta || null],
        );
        sendOk(res, { review_id: r.rows[0].id }, 201);
      } catch (e: any) {
        if (
          String(e?.message || "").includes("unique") ||
          e?.code === "23505"
        ) {
          sendErr(res, 409, "duplicate review");
          return;
        }
        console.error("[peer-review]", e);
        sendErr(res, 500, "internal");
      }
    },
  );

  app.get("/reputation/:userId", async (req, res) => {
    try {
      const uid = String(req.params.userId || "").trim();
      if (!uid) {
        sendErr(res, 400, "user_id required");
        return;
      }
      // Validate UUID before querying to prevent invalid UUID DB errors.
      if (!isValidUuid(uid)) {
        sendErr(res, 400, "invalid user_id", "INVALID_ID");
        return;
      }
      const r = await pool.query(
        `SELECT reputation_score FROM trust.reputation WHERE user_id = $1::uuid`,
        [uid],
      );
      const score = r.rows[0] ? Number(r.rows[0].reputation_score) || 0 : 0;
      sendOk(res, { user_id: uid, score });
    } catch (e) {
      console.error("[reputation]", e);
      sendErr(res, 500, "internal");
    }
  });

  return app;
}

export function startTrustHttpServer(port: number): void {
  const app = createTrustHttpApp();
  app.listen(port, "0.0.0.0", () =>
    console.log(`[trust HTTP] listening on ${port}`),
  );
}
