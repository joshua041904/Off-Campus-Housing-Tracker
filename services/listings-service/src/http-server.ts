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

function amenitiesToStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object") return Object.values(raw as object).map(String);
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
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({ service: "listings", route: req.path, method: req.method, code: res.statusCode })
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ ok: true, db: "connected" });
    } catch {
      res.status(200).json({ ok: true, db: "disconnected", warning: "database unavailable" });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  /** Public browse + search (gateway strips /api/listings → GET / or GET /search). */
  const searchListingsPublic = async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || "").trim();
      const minP = req.query.min_price != null ? Number(req.query.min_price) : null;
      const maxP = req.query.max_price != null ? Number(req.query.max_price) : null;
      const smoke = req.query.smoke_free === "1" || req.query.smoke_free === "true";
      const pets = req.query.pet_friendly === "1" || req.query.pet_friendly === "true";

      const params: unknown[] = [];
      let i = 1;
      const where: string[] = [`status::text = 'active'`, `(deleted_at IS NULL)`];
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
      res.json({ items: result.rows.map((r) => rowToJson(r)) });
    } catch (e) {
      console.error("[listings HTTP search]", e);
      res.status(500).json({ error: "search failed" });
    }
  };

  app.get("/", searchListingsPublic);
  app.get("/search", searchListingsPublic);

  app.get("/listings/:id", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
         FROM listings.listings WHERE id = $1::uuid AND (deleted_at IS NULL)`,
        [req.params.id]
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

  app.post("/create", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const title = String(body.title || "");
      const price_cents = Number(body.price_cents);
      const effective_from = String(body.effective_from || "");
      if (!title || !effective_from || !Number.isFinite(price_cents) || price_cents <= 0) {
        res.status(400).json({ error: "title, effective_from, price_cents required" });
        return;
      }
      const r = await pool.query(
        `INSERT INTO listings.listings (
          user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
          effective_from, effective_until, listed_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::date, NULLIF($10,'')::date, CURRENT_DATE
        ) RETURNING id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at`,
        [
          req.userId,
          title,
          String(body.description || ""),
          price_cents,
          JSON.stringify(body.amenities ?? []),
          Boolean(body.smoke_free),
          Boolean(body.pet_friendly),
          body.furnished != null ? Boolean(body.furnished) : null,
          effective_from,
          String(body.effective_until || ""),
        ]
      );
      res.status(201).json(rowToJson(r.rows[0]));
    } catch (e) {
      console.error("[listings HTTP create]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startListingsHttpServer(port: number): void {
  const app = createListingsHttpApp();
  app.listen(port, "0.0.0.0", () => {
    console.log(`[listings HTTP] listening on ${port}`);
  });
}
