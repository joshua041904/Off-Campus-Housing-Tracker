import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { httpCounter, register, createHttpConcurrencyGuard } from "@common/utils";
import { pool } from "./db.js";
import { publishListingEvent } from "./listing-kafka.js";
import { syncListingCreatedToAnalytics } from "./analytics-sync.js";
import { buildListingsSearchQuery, parseAmenitySlugs } from "./search-listings-query.js";

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

function formatListedAt(row: Record<string, unknown>): string | null {
  const v = row.listed_at;
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  return new Date(v as Date).toISOString().slice(0, 10);
}

/** UUID v4 (RFC) — reject invalid ids before Postgres casts (avoids 500 on bad input). */
const LISTING_ID_UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function truthyQuery(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => truthyQuery(x));
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/** Accept ?in_unit_laundry=true&dishwasher=true style params in addition to amenities= CSV. */
function amenitySlugsFromBooleanQuery(q: Request["query"]): string[] {
  const out: string[] = [];
  const add = (slug: string) => {
    if (!out.includes(slug)) out.push(slug);
  };
  for (const [k, v] of Object.entries(q)) {
    if (!truthyQuery(v)) continue;
    const key = k.toLowerCase();
    if (key === "laundry" || key === "in_unit_laundry") add("in_unit_laundry");
    else if (key === "dishwasher") add("dishwasher");
    else if (key === "garage") add("garage");
    else if (key === "parking") add("parking");
  }
  return out;
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
    latitude: row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
    longitude: row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
    listed_at: formatListedAt(row),
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

  app.use(
    createHttpConcurrencyGuard({
      envVar: "LISTINGS_HTTP_MAX_CONCURRENT",
      defaultMax: 80,
      serviceLabel: "listings-service",
    }),
  );

  /** Public browse + search (gateway strips /api/listings → GET / or GET /search). */
  const searchListingsPublic = async (req: Request, res: Response) => {
    try {
      const searchT0 = Date.now();
      const minP = req.query.min_price != null ? Number(req.query.min_price) : null;
      const maxP = req.query.max_price != null ? Number(req.query.max_price) : null;
      const newWithinRaw = req.query.new_within_days != null ? Number(req.query.new_within_days) : null;
      const newWithin =
        newWithinRaw != null && Number.isFinite(newWithinRaw) && newWithinRaw > 0 && newWithinRaw <= 365
          ? Math.floor(newWithinRaw)
          : null;
      const amenityRaw = [String(req.query.amenity || ""), String(req.query.amenities || "")]
        .filter(Boolean)
        .join(",");
      const amenitySlugs = [
        ...new Set([...parseAmenitySlugs(amenityRaw), ...amenitySlugsFromBooleanQuery(req.query)]),
      ];
      const qStr = String(req.query.q || "").trim();
      const { sql, params } = buildListingsSearchQuery({
        q: qStr,
        minP: minP != null && !Number.isNaN(minP) ? minP : null,
        maxP: maxP != null && !Number.isNaN(maxP) ? maxP : null,
        smoke: req.query.smoke_free === "1" || req.query.smoke_free === "true",
        pets: req.query.pet_friendly === "1" || req.query.pet_friendly === "true",
        furnished: req.query.furnished === "1" || req.query.furnished === "true" || req.query.furnished === "yes",
        amenitySlugs,
        newWithin,
        sort: String(req.query.sort || "created_desc").trim(),
      });
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
            `[listings-http-search-db] ms=${dbMs} rows=${result.rowCount} has_q=${qStr ? "1" : "0"}`,
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
        `SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
                status::text AS status, created_at, listed_at, latitude, longitude
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
        const latRaw = body.latitude;
        const lngRaw = body.longitude;
        const lat =
          latRaw != null && latRaw !== "" && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
        const lng =
          lngRaw != null && lngRaw !== "" && Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : null;

        const r = await pool.query(
          `INSERT INTO listings.listings (
          user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
          effective_from, effective_until, listed_at, latitude, longitude
        ) VALUES (
$1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8,
$9::date, NULLIF($10,'')::date, CURRENT_DATE,
$11, $12
) RETURNING id, user_id, title, description, price_cents,
          amenities, smoke_free, pet_friendly, furnished,
          status::text AS status, created_at,
          listed_at, latitude, longitude`,
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
            lat,
            lng,
          ],
        );

        const row = r.rows[0];

        const eventId = randomUUID();
        const listedDay = formatListedAt(row) || new Date().toISOString().slice(0, 10);

        try {
          await syncListingCreatedToAnalytics({
            eventId,
            listedAtDay: listedDay,
          });
        } catch (e) {
          console.error("[listings HTTP create] analytics sync", e);
          res.status(500).json({ error: "analytics projection sync failed" });
          return;
        }

        void publishListingEvent(
          "ListingCreatedV1",
          String(row.id),
          {
            listing_id: row.id,
            user_id: row.user_id,
            title: row.title,
            price_cents: row.price_cents,
            listed_at_day: listedDay,
          },
          eventId,
        );

        res.status(201).json(rowToJson(row));
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
