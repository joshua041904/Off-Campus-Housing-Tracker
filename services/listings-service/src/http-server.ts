import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { httpCounter, register } from "@common/utils";
import { pool } from "./db.js";

import {
  validateCreateListingInput,
  validateListingId,
  validateSearchFilters,
} from "./validation.js";

type AuthedRequest = Request & { userId?: string };

// Logs per-request HTTP latency and marks requests over the configured threshold as slow.
function attachListingsHttpDiagnostics(app: ReturnType<typeof express>): void {
  const timingEnabled =
    process.env.LISTINGS_HTTP_TIMING === "1" ||
    process.env.LISTINGS_HTTP_TIMING === "true";
  const minMs = Number(process.env.LISTINGS_HTTP_TIMING_MIN_MS ?? "100");
  const poolStatsMs = Number(process.env.LISTINGS_HTTP_POOL_STATS_MS ?? "0");

  if (timingEnabled) {
    console.log(
      `[listings-http-timing] enabled minMs=${minMs} poolStatsMs=${poolStatsMs}`,
    );
    app.use((req, res, next) => {
      const started = Date.now();
      res.on("finish", () => {
        const ms = Date.now() - started;
        const path = req.originalUrl || req.url || req.path;
        const slow = ms > minMs;
        console.log(
          `[listings HTTP] ${slow ? "SLOW REQUEST " : ""}method=${req.method} path=${path} status=${res.statusCode} latency_ms=${ms}`,
        );
      });
      next();
    });
  }

  if (poolStatsMs > 0 && timingEnabled) {
    setInterval(() => {
      console.log(
        `[listings-pool] total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`,
      );
    }, poolStatsMs).unref?.();
  }
}

function requireUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  req.userId = userId;
  next();
}

function amenitiesToStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object")
    return Object.values(raw as object).map(String);
  return [];
}

function rowToJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    price_cents: row.price_cents,
    amenities: amenitiesToStrings(row.amenities),
    smoke_free: row.smoke_free,
    pet_friendly: row.pet_friendly,
    furnished: row.furnished,
    status: row.status,
    created_at: row.created_at,
  };
}

export function createListingsHttpApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  attachListingsHttpDiagnostics(app);
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "listings",
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
      res.status(200).json({ ok: true, db: "connected" });
    } catch {
      res.status(200).json({
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

  /** Public browse + search (gateway strips /api/listings → GET / or GET /search). */
  const searchListingsPublic = async (req: Request, res: Response) => {
    try {
      const searchT0 = Date.now();
      const q = String(req.query.q || "").trim();

      const filterValidation = validateSearchFilters({
        min_price: req.query.min_price,
        max_price: req.query.max_price,
      });
      if (!filterValidation.ok) {
        res.status(400).json({ error: filterValidation.message });
        return;
      }

      const { min_price: minP, max_price: maxP } = filterValidation.value;
      const smoke =
        req.query.smoke_free === "1" || req.query.smoke_free === "true";
      const pets =
        req.query.pet_friendly === "1" || req.query.pet_friendly === "true";

      const params: unknown[] = [];
      let i = 1;
      const where: string[] = [
        `status::text = 'active'`,
        `(deleted_at IS NULL)`,
      ];
      if (q) {
        where.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
        params.push(`%${q.replace(/%/g, "\\%")}%`);
        i++;
      }
      if (minP != null && !Number.isNaN(minP)) {
        where.push(`price_cents >= $${i}`);
        params.push(minP);
        i++;
      }
      if (maxP != null && !Number.isNaN(maxP)) {
        where.push(`price_cents <= $${i}`);
        params.push(maxP);
        i++;
      }
      if (smoke) where.push(`smoke_free = true`);
      if (pets) where.push(`pet_friendly = true`);

      const sql = `
        SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
        FROM listings.listings
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      const result = await pool.query(sql, params);
      const dbMs = Date.now() - searchT0;
      if (
        process.env.LISTINGS_HTTP_TIMING === "1" ||
        process.env.LISTINGS_HTTP_TIMING === "true"
      ) {
        const dbMin = Number(
          process.env.LISTINGS_HTTP_SEARCH_DB_MIN_MS ?? "50",
        );
        if (dbMs >= dbMin) {
          console.log(
            `[listings-http-search-db] ms=${dbMs} rows=${result.rowCount} has_q=${q ? "1" : "0"}`,
          );
        }
      }
      res.json({ items: result.rows.map((r) => rowToJson(r)) });
    } catch (e) {
      console.error("[listings HTTP search]", e);
      res.status(500).json({ error: "search failed" });
    }
  };

  app.get("/", searchListingsPublic);
  app.get("/search", searchListingsPublic);

  app.get("/listings/:id", async (req, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
         FROM listings.listings WHERE id = $1::uuid AND (deleted_at IS NULL)`,
        [validation.value],
      );
      if (!result.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(rowToJson(result.rows[0]));
    } catch (e) {
      console.error("[listings HTTP get]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post(
    "/create",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const body = req.body as Record<string, unknown>;
        const validation = validateCreateListingInput(
          {
            ...body,
            user_id: req.userId,
          },
          { requireUserId: true },
        );

        if (!validation.ok) {
          res.status(400).json({ error: validation.message });
          return;
        }

        const input = validation.value;
        const r = await pool.query(
          `INSERT INTO listings.listings (
          user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
          effective_from, effective_until, listed_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::date, NULLIF($10,'')::date, CURRENT_DATE
        ) RETURNING id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at`,
          [
            input.user_id,
            input.title,
            input.description,
            input.price_cents,
            JSON.stringify(input.amenities),
            input.smoke_free,
            input.pet_friendly,
            input.furnished,
            input.effective_from,
            input.effective_until,
          ],
        );
        res.status(201).json(rowToJson(r.rows[0]));
      } catch (e) {
        console.error("[listings HTTP create]", e);
        res.status(500).json({ error: "internal" });
      }
    },
  );

  return app;
}

export function startListingsHttpServer(port: number): void {
  const app = createListingsHttpApp();
  app.listen(port, "0.0.0.0", () => {
    console.log(`[listings HTTP] listening on ${port}`);
  });
}
