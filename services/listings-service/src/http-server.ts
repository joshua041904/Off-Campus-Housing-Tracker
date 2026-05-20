import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  httpCounter,
  register,
  createHttpConcurrencyGuard,
  initOchOutboxSurfaceUnsupported,
} from "@common/utils";
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware } from "@common/utils/otel";
import { pool } from "./db.js";
import { publishListingEventForCreateResponse } from "./listing-kafka.js";
import { syncListingCreatedToAnalytics } from "./analytics-sync.js";
import { fireSavedSearchNotifyForNewListing } from "./notify-saved-search-on-create.js";
import {
  buildListingsSearchQuery,
  parseAmenitySlugs,
  parseResidenceTypesCsv,
} from "./search-listings-query.js";
import {
  enrichSearchRows,
  fetchWatchCountsByListingId,
} from "./search-result-enrichment.js";
import {
  MAX_LISTING_IMAGES_PER_CREATE,
  validateListingImageUrlHead,
  validateListingImageUrlShape,
  validateListingImageUrlsForCreate,
} from "./listing-media-validation.js";
import {
  publicRevisionLinesFromChanges,
  sanitizePublicRevisionChanges,
} from "./listing-revisions-public.js";
import { publishCommunityEvent } from "./community-kafka.js";
import { fetchLandlordHandleFromTrust } from "./trust-username-resolve.js";
import { buildListingsCacheKey, getCachedSearch, getListingBookingCount, setCachedSearch } from "./query-cache.js";
import {
  defaultSearchOccupancyUtcDay,
  fetchReservedSearchListingIds,
  occupancyForReservedFromSearchParams,
} from "./booking-search-exclusion.js";
import { mapCommunityImagesJson, refreshCommunityImageUrlIfPublicInline } from "./lib/community-media-url.js";

import {
  validateCreateListingInput,
  validateListingId,
  validateSearchFilters,
} from "./validation.js";
import { computeListingRevisionChanges } from "./listing-revision-diff.js";
import { insertListingRevisionEntry } from "./listing-revision-write.js";
import {
  buildDisplayLocationForCreate,
  formatListingPublicLocation,
  normalizeResidenceType,
} from "./location-display.js";
import { geocodeStructuredAddress } from "./geocode-address.js";

type AuthedRequest = Request & { userId?: string };

function normalizeOptStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseYmdFromBody(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

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

/** Snapshot author identity on community rows (no cross-DB auth join). */
function communityAuthorFromRequest(req: AuthedRequest): {
  author_display_name: string | null;
  author_username: string;
} {
  const email = (req.get("x-user-email") || "").trim().toLowerCase();
  if (!email.includes("@")) {
    return { author_display_name: null, author_username: "user" };
  }
  let local = (email.split("@")[0] ?? "").trim();
  local = local.replace(/\+.*/, "").trim();
  const username = local
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return { author_display_name: null, author_username: username || "user" };
}

/** Persisted on listings: prefer gateway JWT username, else email-local handle (matches community author rules). */
function listingHostDisplayFromHeaders(req: Request): string {
  const fromGateway = (req.get("x-user-username") || "").trim();
  if (fromGateway) return fromGateway.slice(0, 120);
  const snap = communityAuthorFromRequest(req as AuthedRequest);
  const u = String(snap.author_username || "").trim();
  if (u && u !== "user") return u.slice(0, 120);
  return "";
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

/** eBay-style search paging contract (validated only when `page` is present). */
const EBAY_PAGE_SIZES = new Set([24, 48, 72, 96, 120, 128, 240]);

const LISTINGS_BOOKING_INTERNAL_SECRET = (
  process.env.LISTINGS_BOOKING_INTERNAL_SECRET ||
  process.env.BOOKING_LISTINGS_INTERNAL_SECRET ||
  ""
).trim();

function truthyQuery(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => truthyQuery(x));
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
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
    else if (key === "utilities_included" || key === "utilities") add("utilities_included");
  }
  return out;
}

const LISTINGS_DETAIL_SQL = `
SELECT l.id, l.user_id, l.username_display, l.title, l.description, l.price_cents, l.amenities,
       l.smoke_free, l.pet_friendly, l.furnished, l.status::text AS status,
       l.created_at, l.updated_at, l.listed_at, l.latitude, l.longitude, l.display_location,
       l.effective_from, l.effective_until, l.lease_length_months,
       l.size_sqft, l.residence_type, l.address_line1, l.address_line2, l.city, l.state_or_province,
       l.postal_code, l.country, l.neighborhood, l.bedrooms, l.bathrooms,
       COALESCE(l.pricing_mode::text, 'fixed') AS pricing_mode,
       l.soft_hold_until,
       COALESCE(
         (SELECT json_agg(m.url_or_path ORDER BY m.sort_order ASC, m.created_at ASC)
          FROM listings.listing_media m
          WHERE m.listing_id = l.id AND m.media_type = 'image'),
         '[]'::json
       ) AS images_json,
       COALESCE(
         (SELECT json_agg(json_build_object(
              'id', m.id,
              'url_or_path', m.url_or_path,
              'media_type', m.media_type,
              'sort_order', m.sort_order
            ) ORDER BY m.sort_order ASC, m.created_at ASC)
          FROM listings.listing_media m
          WHERE m.listing_id = l.id),
         '[]'::json
       ) AS media_items_json
FROM listings.listings l
WHERE l.id = $1::uuid AND (l.deleted_at IS NULL)
`;

function landlordDisplayLabel(row: Record<string, unknown>): string {
  const raw = String(row.username_display ?? "").trim();
  if (raw) return raw.slice(0, 120);
  /** Never show UUID fragments as the host label — prefer trust/username_display backfill. */
  return "Host";
}

function milesToCampus(lat: number | null, lng: number | null): number | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const campusLat = 42.3868;
  const campusLng = -72.5301;
  const dLat = ((lat - campusLat) * Math.PI) / 180;
  const dLng = ((lng - campusLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((campusLat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(3958.8 * c * 10) / 10;
}

/** Compact marketplace detail for GET /listings/:id and GET /:uuid (gateway alias). */
function parseMediaItemsJson(raw: unknown): Array<{
  id: string;
  url_or_path: string;
  media_type: string;
  sort_order: number;
}> {
  if (!raw) return [];
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      if (Array.isArray(p)) arr = p;
    } catch {
      return [];
    }
  }
  const out: Array<{ id: string; url_or_path: string; media_type: string; sort_order: number }> = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = String(o.id ?? "");
    const url_or_path = String(o.url_or_path ?? "");
    if (!id || !url_or_path) continue;
    const media_type = String(o.media_type ?? "image").toLowerCase();
    const so = Number(o.sort_order);
    out.push({
      id,
      url_or_path,
      media_type,
      sort_order: Number.isFinite(so) ? Math.floor(so) : 0,
    });
  }
  return out;
}

function listingDetailMarketplace(
  row: Record<string, unknown>,
  opts?: { includePrivateAddress?: boolean },
) {
  const amenities = amenitiesToStrings(row.amenities);
  const media_items = parseMediaItemsJson(row.media_items_json);
  let images: string[] = [];
  const ij = row.images_json;
  if (Array.isArray(ij)) images = ij.map(String);
  else if (typeof ij === "string") {
    try {
      const p = JSON.parse(ij) as unknown;
      if (Array.isArray(p)) images = p.map(String);
    } catch {
      images = [];
    }
  }
  /** If images_json empty but media rows exist (e.g. legacy), derive image URLs from media_items. */
  if (!images.length && media_items.length) {
    images = media_items.filter((m) => m.media_type === "image").map((m) => m.url_or_path);
  }
  images = images.map((u) => refreshCommunityImageUrlIfPublicInline(String(u)));
  for (let i = 0; i < media_items.length; i++) {
    const m = media_items[i];
    if (!m) continue;
    media_items[i] = {
      ...m,
      url_or_path: refreshCommunityImageUrlIfPublicInline(m.url_or_path),
    };
  }
  const price_cents = Number(row.price_cents);
  const price = Number.isFinite(price_cents) ? Math.round(price_cents) / 100 : null;
  const lat =
    row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
  const lng =
    row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
  const sq = row.size_sqft;
  const square_feet =
    sq != null && Number.isFinite(Number(sq)) ? Math.max(0, Math.floor(Number(sq))) : null;
  const br = row.bedrooms;
  const bedrooms =
    br != null && Number.isFinite(Number(br)) ? Math.max(0, Math.floor(Number(br))) : null;
  const ba = row.bathrooms;
  const bathrooms =
    ba != null && Number.isFinite(Number(ba)) ? Math.round(Number(ba) * 10) / 10 : null;
  const pricingRaw = String(row.pricing_mode ?? "fixed").trim().toLowerCase();
  const pricing_mode = pricingRaw === "obo" ? "obo" : "fixed";
  let soft_hold_until: string | null = null;
  const sh = row.soft_hold_until;
  if (sh instanceof Date) soft_hold_until = sh.toISOString();
  else if (sh != null && String(sh).trim()) soft_hold_until = String(sh).trim();
  const holdMs = soft_hold_until ? Date.parse(soft_hold_until) : NaN;
  const listing_on_hold = Number.isFinite(holdMs) && holdMs > Date.now();
  const base: Record<string, unknown> = {
    id: row.id,
    user_id: row.user_id,
    landlord_id: row.user_id,
    landlord_display: landlordDisplayLabel(row),
    title: row.title,
    description: row.description ?? "",
    price_cents: row.price_cents,
    price,
    residence_type: row.residence_type ?? null,
    square_feet,
    bedrooms,
    bathrooms,
    city: row.city ?? null,
    state_or_province: row.state_or_province ?? null,
    country: row.country ?? null,
    neighborhood: row.neighborhood ?? null,
    location: formatListingPublicLocation(row),
    amenities,
    images,
    primaryImageUrl: images[0] ?? null,
    distance_miles_to_campus: milesToCampus(lat, lng),
    watch_count: 0,
    lease_terms: {
      effective_from: row.effective_from ?? null,
      effective_until: row.effective_until ?? null,
      lease_length_months: row.lease_length_months ?? null,
    },
    availability_status: String(row.status ?? "unknown"),
    pricing_mode,
    soft_hold_until,
    listing_on_hold,
    media_items,
  };
  if (opts?.includePrivateAddress) {
    base.address_line1 = row.address_line1 ?? null;
    base.address_line2 = row.address_line2 ?? null;
    base.postal_code = row.postal_code ?? null;
    if (lat != null && lng != null) {
      base.latitude = lat;
      base.longitude = lng;
    }
  }
  return base;
}

function requesterUserId(req: Request): string | null {
  const raw = (req.get("x-user-id") || "").trim();
  return raw.length > 0 ? raw : null;
}

/** Non-active listings are only visible to the landlord (x-user-id). */
function listingMarketplaceVisibleToRequester(
  row: Record<string, unknown>,
  viewer: string | null,
): boolean {
  const st = String(row.status ?? "").toLowerCase();
  if (st === "active") return true;
  if (!viewer) return false;
  return String(row.user_id ?? "") === viewer;
}

async function listingDetailResponsePayload(
  row: Record<string, unknown>,
  listingId: string,
  viewerUserId: string | null,
) {
  let rowForDetail = row;
  if (!String(row.username_display ?? "").trim()) {
    const trustHandle = await fetchLandlordHandleFromTrust(String(row.user_id ?? ""));
    if (trustHandle) {
      rowForDetail = { ...row, username_display: trustHandle };
    }
  }
  const owner =
    viewerUserId != null &&
    viewerUserId.length > 0 &&
    String(row.user_id ?? "") === String(viewerUserId);
  const detail = listingDetailMarketplace(rowForDetail, { includePrivateAddress: owner });
  try {
    const wc = await fetchWatchCountsByListingId([listingId]);
    detail.watch_count = wc[listingId] ?? 0;
  } catch {
    detail.watch_count = 0;
  }
  return detail;
}

const LANDLORD_LISTING_STATUS_SET = new Set(["active", "paused", "archived"]);

async function proxyBookingWatchlist(
  userId: string,
  listingId: string,
  remove: boolean,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const base = (process.env.BOOKING_HTTP || "http://127.0.0.1:4013").replace(
    /\/$/,
    "",
  );
  const path = remove ? "/watchlist/remove" : "/watchlist/add";
  const url = `${base}${path}`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify(
      remove ? { listingId } : { listingId, source: "listings-save" },
    ),
  });
  const text = await upstream.text();
  let body: unknown = {};
  try {
    body = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: upstream.ok, status: upstream.status, body };
}

/** Marketplace-oriented JSON (additive fields; keeps existing keys). */
function rowToJson(row: Record<string, unknown>) {
  const price_cents = Number(row.price_cents);
  const price_usd =
    Number.isFinite(price_cents) ? Math.round(price_cents) / 100 : null;
  const title = String(row.title || "");
  const description = String(row.description || "");
  const text = `${title} ${description}`;
  const bedMatch = text.match(/(\d+)\s*(?:bed|br)\b/i);
  const bathMatch = text.match(/(\d+)\s*(?:bath|ba)\b/i);
  const brCol =
    row.bedrooms != null && Number.isFinite(Number(row.bedrooms))
      ? Math.max(0, Math.floor(Number(row.bedrooms)))
      : null;
  const baCol =
    row.bathrooms != null && Number.isFinite(Number(row.bathrooms))
      ? Math.round(Number(row.bathrooms) * 10) / 10
      : null;
  const primaryImageUrlRaw =
    typeof row.primary_image_url === "string" && row.primary_image_url.trim().length > 0
      ? row.primary_image_url.trim()
      : null;
  const primaryImageUrl = primaryImageUrlRaw
    ? refreshCommunityImageUrlIfPublicInline(primaryImageUrlRaw)
    : null;
  const sq = row.size_sqft;
  const square_feet =
    sq != null && Number.isFinite(Number(sq)) ? Math.max(0, Math.floor(Number(sq))) : null;
  const pmRaw = String(row.pricing_mode ?? "fixed").trim().toLowerCase();
  const pricing_mode = pmRaw === "obo" ? "obo" : "fixed";
  let soft_hold_until: string | null = null;
  const sh = row.soft_hold_until;
  if (sh instanceof Date) soft_hold_until = sh.toISOString();
  else if (sh != null && String(sh).trim()) soft_hold_until = String(sh).trim();
  const holdMs = soft_hold_until ? Date.parse(soft_hold_until) : NaN;
  const listing_on_hold = Number.isFinite(holdMs) && holdMs > Date.now();
  return {
    id: row.id,
    user_id: row.user_id,
    landlord_id: row.user_id,
    title: row.title,
    description: row.description,
    price_cents: row.price_cents,
    /** Monthly rent in USD (derived from price_cents). */
    price: price_usd,
    price_usd_monthly: price_usd,
    amenities: amenitiesToStrings(row.amenities),
    smoke_free: row.smoke_free,
    pet_friendly: row.pet_friendly,
    furnished: row.furnished,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
    listed_at: formatListedAt(row),
    effective_from: row.effective_from ?? null,
    effective_until: row.effective_until ?? null,
    lease_length_months: row.lease_length_months ?? null,
    size_sqft: row.size_sqft ?? null,
    square_feet,
    residence_type: row.residence_type ?? null,
    city: row.city ?? null,
    state_or_province: row.state_or_province ?? null,
    country: row.country ?? null,
    neighborhood: row.neighborhood ?? null,
    bedrooms: brCol ?? (bedMatch ? Math.max(1, Number(bedMatch[1])) : null),
    bathrooms: baCol ?? (bathMatch ? Math.max(1, Number(bathMatch[1])) : null),
    username_display: row.username_display ?? null,
    landlord_display: landlordDisplayLabel(row),
    watch_count:
      row.watch_count != null && Number.isFinite(Number(row.watch_count))
        ? Math.max(0, Math.floor(Number(row.watch_count)))
        : 0,
    location: formatListingPublicLocation(row),
    distance_miles_to_campus: milesToCampus(
      row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
      row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
    ),
    lease_terms: {
      effective_from: row.effective_from ?? null,
      effective_until: row.effective_until ?? null,
      lease_length_months: row.lease_length_months ?? null,
    },
    images: primaryImageUrl ? [primaryImageUrl] : ([] as string[]),
    primaryImageUrl,
    availability_status: String(row.status || "unknown"),
    pricing_mode,
    soft_hold_until,
    listing_on_hold,
  };
}

function dedupeListingsById(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

export function createListingsHttpApp() {
  const app = express();
  initOchOutboxSurfaceUnsupported();
  app.use(tracingMiddleware);
  mountDebugTraceHeaders(app);
  app.use(express.json({ limit: "1mb" }));
  attachListingsHttpDiagnostics(app);
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "listings",
        route: req.path,
        method: req.method,
        code: res.statusCode,
        proto: inferNetProtoForSpan(req),
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

  app.get("/mine", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT l.id, l.title, l.status::text AS status, l.created_at, l.updated_at,
                l.price_cents, l.description, l.amenities,
                l.residence_type, l.size_sqft, l.display_location, l.city, l.state_or_province, l.country, l.neighborhood,
                l.bedrooms, l.bathrooms, l.listed_at,
                (
                  SELECT m.url_or_path
                  FROM listings.listing_media m
                  WHERE m.listing_id = l.id AND m.media_type = 'image'
                  ORDER BY m.sort_order ASC, m.created_at ASC
                  LIMIT 1
                ) AS primary_image_url
         FROM listings.listings l
         WHERE l.user_id = $1::uuid AND l.deleted_at IS NULL
         ORDER BY l.created_at DESC
         LIMIT 200`,
        [req.userId!],
      );
      const rows = r.rows as Record<string, unknown>[];
      const ids = rows.map((x) => String(x.id ?? "")).filter(Boolean);
      let wc: Record<string, number> = {};
      try {
        wc = await fetchWatchCountsByListingId(ids);
      } catch {
        wc = {};
      }
      const items = rows.map((row) => {
        const id = String(row.id ?? "");
        const price_cents = Number(row.price_cents);
        const price_usd =
          Number.isFinite(price_cents) ? Math.round(price_cents) / 100 : null;
        const sq = row.size_sqft;
        const square_feet =
          sq != null && Number.isFinite(Number(sq)) ? Math.max(0, Math.floor(Number(sq))) : null;
        return {
          ...row,
          price_usd_monthly: price_usd,
          square_feet,
          location: formatListingPublicLocation(row),
          watch_count: id ? wc[id] ?? 0 : 0,
        };
      });
      res.json({ items });
    } catch (e) {
      console.error("[listings HTTP mine]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.use(
    createHttpConcurrencyGuard({
      envVar: "LISTINGS_HTTP_MAX_CONCURRENT",
      defaultMax: 80,
      serviceLabel: "listings-service",
    }),
  );

  /** Booking-service internal: compact listing card for moderation / fraud dashboards (mTLS-ish via shared secret). */
  app.get("/internal/listings/:listingId", async (req, res) => {
    try {
      const secret = (req.get("x-booking-internal-secret") || "").trim();
      if (!LISTINGS_BOOKING_INTERNAL_SECRET || secret !== LISTINGS_BOOKING_INTERNAL_SECRET) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const listingId = req.params.listingId || "";
      if (!LISTING_ID_UUID_RX.test(listingId)) {
        res.status(400).json({ error: "invalid listing id" });
        return;
      }
      const q = await pool.query(LISTINGS_DETAIL_SQL, [listingId]);
      const row = q.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const d = listingDetailMarketplace(row);
      const priceCentsRaw = Number(d.price_cents);
      const priceCents =
        Number.isFinite(priceCentsRaw) && priceCentsRaw >= 0 ? Math.floor(priceCentsRaw) : 0;
      const ownerId = d.landlord_id != null ? String(d.landlord_id) : d.user_id != null ? String(d.user_id) : "";
      res.json({
        id: String(d.id),
        title: String(d.title ?? ""),
        landlord_id: ownerId || null,
        user_id: d.user_id != null ? String(d.user_id) : null,
        landlord_display: d.landlord_display != null ? String(d.landlord_display) : null,
        price_cents: priceCents,
        price_usd_monthly: d.price,
        location: d.location,
        primary_image_url: d.primaryImageUrl,
        pricing_mode: d.pricing_mode != null ? String(d.pricing_mode) : "fixed",
        soft_hold_until: d.soft_hold_until != null ? String(d.soft_hold_until) : null,
        listing_on_hold: Boolean(d.listing_on_hold),
      });
    } catch (e) {
      console.error("[listings HTTP internal listing]", e);
      res.status(500).json({ error: "internal listing fetch failed" });
    }
  });

  /** Public browse + search (gateway strips /api/listings → GET / or GET /search). */
  const searchListingsPublic = async (req: Request, res: Response) => {
    try {
      const searchT0 = Date.now();
      const minP = req.query.min_price != null
        ? Number(req.query.min_price)
        : req.query.minPrice != null
          ? Number(req.query.minPrice)
          : null;
      const maxP = req.query.max_price != null
        ? Number(req.query.max_price)
        : req.query.maxPrice != null
          ? Number(req.query.maxPrice)
          : null;
      const newWithinRaw =
        req.query.new_within_days != null
          ? Number(req.query.new_within_days)
          : null;
      const newWithin =
        newWithinRaw != null &&
        Number.isFinite(newWithinRaw) &&
        newWithinRaw > 0 &&
        newWithinRaw <= 365
          ? Math.floor(newWithinRaw)
          : null;
      // Parse pagination params; invalid values fall back to builder defaults.
      const limitRaw = req.query.limit != null ? Number(req.query.limit) : null;
      const offsetRaw =
        req.query.offset != null ? Number(req.query.offset) : null;
      const pageRaw = req.query.page != null ? Number(req.query.page) : null;
      const pageSizeRaw = req.query.pageSize != null ? Number(req.query.pageSize) : null;
      const cursorRaw = String(req.query.cursor || "").trim();

      const limit =
        limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.floor(limitRaw)
          : null;

      const offset =
        offsetRaw != null && Number.isFinite(offsetRaw) && offsetRaw >= 0
          ? Math.floor(offsetRaw)
          : null;
      // Cursor is opaque base64 of offset; fallback to explicit offset for compatibility.
      const cursorOffset = (() => {
        if (!cursorRaw) return null;
        try {
          const decoded = Buffer.from(cursorRaw, "base64url").toString("utf8");
          const n = Number(decoded);
          return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
        } catch {
          return null;
        }
      })();

      const pageParsed =
        pageRaw != null && Number.isFinite(pageRaw) && pageRaw > 0 ? Math.max(1, Math.floor(pageRaw)) : null;

      let queryLimit = limit ?? pageSizeRaw;
      let queryOffset: number | null = cursorOffset ?? offset;

      if (pageParsed != null) {
        const ps =
          pageSizeRaw != null && Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
            ? Math.floor(pageSizeRaw)
            : 24;
        if (!EBAY_PAGE_SIZES.has(ps)) {
          res.status(400).json({ error: "invalid_page_size" });
          return;
        }
        queryLimit = ps;
        queryOffset = (pageParsed - 1) * ps;
      }

      const bedroomsRaw =
        req.query.bedrooms != null ? Number(req.query.bedrooms) : null;
      const bedrooms =
        bedroomsRaw != null &&
        Number.isFinite(bedroomsRaw) &&
        bedroomsRaw > 0 &&
        bedroomsRaw <= 10
          ? Math.floor(bedroomsRaw)
          : null;
      const bathroomsRaw =
        req.query.bathrooms != null ? Number(req.query.bathrooms) : null;
      const bathrooms =
        bathroomsRaw != null &&
        Number.isFinite(bathroomsRaw) &&
        bathroomsRaw > 0 &&
        bathroomsRaw <= 10
          ? Math.floor(bathroomsRaw)
          : null;
      const minLeaseRaw =
        req.query.min_lease_months != null ? Number(req.query.min_lease_months) : null;
      const minLeaseMonths =
        minLeaseRaw != null && Number.isFinite(minLeaseRaw) && minLeaseRaw > 0 && minLeaseRaw <= 60
          ? Math.floor(minLeaseRaw)
          : null;
      const availableFromRaw = String(req.query.available_from || req.query.availableFrom || "").trim();
      const availableFrom = /^\d{4}-\d{2}-\d{2}$/.test(availableFromRaw)
        ? availableFromRaw
        : null;
      const amenityRaw = [
        String(req.query.amenity || ""),
        String(req.query.amenities || ""),
      ]
        .filter(Boolean)
        .join(",");
      const amenitySlugs = [
        ...new Set([
          ...parseAmenitySlugs(amenityRaw),
          ...amenitySlugsFromBooleanQuery(req.query),
        ]),
      ];
      const qStr = String(req.query.q || req.query.query || "").trim();
      const campusLat =
        req.query.campusLat != null && Number.isFinite(Number(req.query.campusLat))
          ? Number(req.query.campusLat)
          : null;
      const campusLng =
        req.query.campusLng != null && Number.isFinite(Number(req.query.campusLng))
          ? Number(req.query.campusLng)
          : null;
      const occStartRaw = String(
        req.query.available_start ||
          req.query.availableStart ||
          req.query.occupancy_start ||
          req.query.occupancyStart ||
          "",
      )
        .trim()
        .slice(0, 10);
      const occEndRaw = String(
        req.query.available_end ||
          req.query.availableEnd ||
          req.query.occupancy_end ||
          req.query.occupancyEnd ||
          "",
      )
        .trim()
        .slice(0, 10);
      const occupancyOverlap =
        /^\d{4}-\d{2}-\d{2}$/.test(occStartRaw) && /^\d{4}-\d{2}-\d{2}$/.test(occEndRaw)
          ? { start: occStartRaw <= occEndRaw ? occStartRaw : occEndRaw, end: occStartRaw <= occEndRaw ? occEndRaw : occStartRaw }
          : /^\d{4}-\d{2}-\d{2}$/.test(occStartRaw)
            ? { start: occStartRaw, end: occStartRaw }
            : null;
      /** Overlap window for booking-service reserved-listing filter (must stay aligned with cache key). */
      const occupancyForReserved = occupancyForReservedFromSearchParams(occupancyOverlap, availableFrom);
      /** Must match overlap sent to booking-service (explicit UTC day default avoids stale cache across UTC midnight). */
      const occupancyForCache = occupancyForReserved ?? defaultSearchOccupancyUtcDay();
      const searchLatRaw = req.query.search_lat ?? req.query.searchLat;
      const searchLngRaw = req.query.search_lng ?? req.query.searchLng;
      const radiusMilesRaw =
        req.query.radius_miles != null
          ? Number(req.query.radius_miles)
          : req.query.radiusMiles != null
            ? Number(req.query.radiusMiles)
            : null;
      const searchCenterLat =
        searchLatRaw != null && searchLatRaw !== "" && Number.isFinite(Number(searchLatRaw))
          ? Number(searchLatRaw)
          : null;
      const searchCenterLng =
        searchLngRaw != null && searchLngRaw !== "" && Number.isFinite(Number(searchLngRaw))
          ? Number(searchLngRaw)
          : null;
      const radiusMiles =
        radiusMilesRaw != null && Number.isFinite(radiusMilesRaw) && radiusMilesRaw > 0
          ? Math.min(200, radiusMilesRaw)
          : null;

      const residenceCsv = String(
        req.query.residence_type || req.query.residenceType || req.query.residence_types || "",
      ).trim();
      const residenceTypes = parseResidenceTypesCsv(residenceCsv);
      const minSqftRaw =
        req.query.min_sqft != null
          ? Number(req.query.min_sqft)
          : req.query.minSqft != null
            ? Number(req.query.minSqft)
            : null;
      const minSqft =
        minSqftRaw != null && Number.isFinite(minSqftRaw) && minSqftRaw > 0 ? Math.floor(minSqftRaw) : null;
      const maxSqftRaw =
        req.query.max_sqft != null
          ? Number(req.query.max_sqft)
          : req.query.maxSqft != null
            ? Number(req.query.maxSqft)
            : null;
      const maxSqft =
        maxSqftRaw != null && Number.isFinite(maxSqftRaw) && maxSqftRaw > 0 ? Math.floor(maxSqftRaw) : null;
      const cityQ = String(req.query.city || "").trim().slice(0, 120);
      const stateQ = String(req.query.state || req.query.state_or_province || "").trim().slice(0, 80);
      const neighborhoodQ = String(req.query.neighborhood || "").trim().slice(0, 160);
      const campusWithinRaw =
        req.query.campus_within_miles != null
          ? Number(req.query.campus_within_miles)
          : req.query.campusWithinMiles != null
            ? Number(req.query.campusWithinMiles)
            : null;
      const campusWithinMiles =
        campusWithinRaw != null && Number.isFinite(campusWithinRaw) && campusWithinRaw > 0
          ? Math.min(50, campusWithinRaw)
          : null;

      const cacheKey = buildListingsCacheKey({
        q: qStr,
        minP,
        maxP,
        smoke: req.query.smoke_free,
        pets: req.query.pet_friendly,
        furnished: req.query.furnished,
        amenitySlugs,
        newWithin,
        sort: String(req.query.sort || "created_desc").trim(),
        limit: queryLimit,
        offset: queryOffset,
        page: pageRaw,
        pageSize: pageSizeRaw,
        bedrooms,
        bathrooms,
        availableFrom,
        minLeaseMonths,
        campusLat,
        campusLng,
        searchCenterLat,
        searchCenterLng,
        radiusMiles,
        residenceTypes,
        minSqft,
        maxSqft,
        city: cityQ || null,
        state: stateQ || null,
        neighborhood: neighborhoodQ || null,
        campusWithinMiles,
        occupancyStart: occupancyForCache.start,
        occupancyEnd: occupancyForCache.end,
      });
      const cached = await getCachedSearch(cacheKey);
      if (cached) {
        res.setHeader("Cache-Control", "public, max-age=10");
        res.json(JSON.parse(cached));
        return;
      }

      const { sql, params } = buildListingsSearchQuery({
        q: qStr,
        minP: minP != null && !Number.isNaN(minP) ? minP : null,
        maxP: maxP != null && !Number.isNaN(maxP) ? maxP : null,
        smoke: req.query.smoke_free === "1" || req.query.smoke_free === "true",
        pets:
          req.query.pet_friendly === "1" || req.query.pet_friendly === "true",
        furnished:
          req.query.furnished === "1" ||
          req.query.furnished === "true" ||
          req.query.furnished === "yes",
        amenitySlugs,
        newWithin,
        sort: String(req.query.sort || "created_desc").trim(),
        limit: queryLimit,
        offset: queryOffset,
        page: pageParsed != null ? pageRaw : null,
        pageSize: pageParsed != null ? queryLimit : pageSizeRaw,
        bedrooms,
        bathrooms,
        availableFrom,
        minLeaseMonths,
        campusLat,
        campusLng,
        searchCenterLat:
          searchCenterLat != null &&
          searchCenterLng != null &&
          radiusMiles != null
            ? searchCenterLat
            : null,
        searchCenterLng:
          searchCenterLat != null &&
          searchCenterLng != null &&
          radiusMiles != null
            ? searchCenterLng
            : null,
        radiusMiles:
          searchCenterLat != null &&
          searchCenterLng != null &&
          radiusMiles != null
            ? radiusMiles
            : null,
        campusWithinMiles,
        residenceTypes,
        minSqft,
        maxSqft,
        city: cityQ || null,
        state: stateQ || null,
        neighborhood: neighborhoodQ || null,
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
      const uniqueRows = dedupeListingsById(
        result.rows as Record<string, unknown>[],
      );
      const listingIdsOnPage = uniqueRows.map((r) => String((r as Record<string, unknown>).id));
      const reserved = await fetchReservedSearchListingIds(listingIdsOnPage, occupancyForReserved);
      const marketplaceRows = uniqueRows.filter(
        (r) => !reserved.has(String((r as Record<string, unknown>).id)),
      );
      const lim =
        queryLimit != null && Number.isFinite(queryLimit) && queryLimit > 0
          ? Math.min(Math.floor(queryLimit), 240)
          : 50;
      const off =
        queryOffset != null && Number.isFinite(queryOffset) && queryOffset >= 0 ? Math.floor(queryOffset) : 0;

      const sqlTotal =
        marketplaceRows.length > 0 ? Number((marketplaceRows[0] as Record<string, unknown>).total_count ?? 0) : 0;
      const removedFromPage = uniqueRows.length - marketplaceRows.length;
      const totalCount = Math.max(0, sqlTotal - removedFromPage);

      const stripped = marketplaceRows.map((r) => {
        const row = { ...(r as Record<string, unknown>) };
        delete row.total_count;
        return row;
      });
      const sortParam = String(req.query.sort || "created_desc").trim();
      await enrichSearchRows(stripped, { sort: sortParam });
      const data = stripped.map((r) => rowToJson(r));
      const nextCursor =
        data.length >= lim
          ? Buffer.from(String(off + lim), "utf8").toString("base64url")
          : null;
      const totalPages = lim > 0 ? Math.ceil(totalCount / lim) : 0;
      const payload = {
        items: data,
        data,
        listings: data,
        nextCursor,
        totalApprox: totalCount,
        totalCount,
        page: pageParsed ?? undefined,
        pageSize: pageParsed != null ? lim : undefined,
        totalPages: pageParsed != null ? totalPages : undefined,
      };
      await setCachedSearch(cacheKey, JSON.stringify(payload));
      res.setHeader("Cache-Control", "public, max-age=10");
      res.json(payload);
    } catch (e) {
      console.error("[listings HTTP search]", e);
      res.status(500).json({ error: "search failed" });
    }
  };

  app.get("/", searchListingsPublic);
  app.get("/search", searchListingsPublic);

  const COMMUNITY_FLAIR_SET = new Set(["landlord", "renter", "announcement", "general"]);

  app.get("/community/posts", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSizeRaw = Number(req.query.pageSize ?? 24);
      if (!EBAY_PAGE_SIZES.has(pageSizeRaw)) {
        res.status(400).json({ error: "invalid_page_size" });
        return;
      }
      const offset = (page - 1) * pageSizeRaw;
      const flairRaw = String(req.query.flair ?? "").trim().toLowerCase();
      const qRaw = String(req.query.q ?? req.query.query ?? "").trim();
      const where: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (flairRaw && COMMUNITY_FLAIR_SET.has(flairRaw)) {
        where.push(`lower(p.flair) = $${i}`);
        params.push(flairRaw);
        i++;
      }
      if (qRaw) {
        where.push(`(p.title ILIKE $${i} OR p.body ILIKE $${i})`);
        params.push(`%${qRaw.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
        i++;
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const limitIdx = i;
      const offsetIdx = i + 1;
      params.push(pageSizeRaw, offset);
      const viewerId = (req.get("x-user-id") || "").trim();
      const viewerUuid = LISTING_ID_UUID_RX.test(viewerId) ? viewerId : null;
      const viewerIdx = i + 2;
      params.push(viewerUuid);
      const sql = `
        SELECT p.id,
               p.author_id,
               p.author_display_name,
               p.author_username,
               p.title,
               p.body,
               p.flair,
               p.created_at,
               COALESCE(
                 (SELECT json_agg(json_build_object('url', i.image_url, 'alt', i.alt_text) ORDER BY i.sort_order, i.created_at)
                    FROM listings.community_post_images i
                   WHERE i.post_id = p.id),
                 '[]'::json
               ) AS images,
               (SELECT COUNT(*)::int FROM listings.community_comments c WHERE c.post_id = p.id) AS comment_count,
               (SELECT COALESCE(SUM(v.value), 0)::int FROM listings.community_post_votes v WHERE v.post_id = p.id) AS vote_count,
               (SELECT pv.value FROM listings.community_post_votes pv
                  WHERE pv.post_id = p.id AND $${viewerIdx}::uuid IS NOT NULL AND pv.user_id = $${viewerIdx}::uuid LIMIT 1) AS your_vote,
               COUNT(*) OVER() AS total_count
        FROM listings.community_posts p
        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      const result = await pool.query(sql, params);
      const rows = result.rows as Record<string, unknown>[];
      const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
      const posts = rows.map((r) => {
        const { total_count: _t, ...rest } = r;
        const yv = rest.your_vote;
        const yourVote =
          typeof yv === "number" && Number.isFinite(yv) ? (yv === -1 || yv === 1 ? yv : null) : null;
        return {
          id: rest.id,
          author_id: rest.author_id,
          author_display_name: rest.author_display_name ?? null,
          author_username: rest.author_username ?? null,
          title: rest.title,
          body: rest.body,
          flair: String(rest.flair ?? "general"),
          images: mapCommunityImagesJson(rest.images),
          created_at:
            rest.created_at instanceof Date
              ? rest.created_at.toISOString()
              : String(rest.created_at ?? ""),
          commentCount: Number(rest.comment_count ?? 0),
          voteCount: Number(rest.vote_count ?? 0),
          yourVote,
        };
      });
      const totalPages = Math.ceil(totalCount / pageSizeRaw);
      res.json({ posts, totalCount, page, totalPages });
    } catch (e) {
      console.error("[listings HTTP community posts]", e);
      res.status(500).json({ error: "community posts failed" });
    }
  });

  app.get("/community/posts/:postId/comments", async (req, res) => {
    try {
      const postId = req.params.postId || "";
      if (!LISTING_ID_UUID_RX.test(postId)) {
        res.status(400).json({ error: "invalid post id" });
        return;
      }
      const viewerId = (req.get("x-user-id") || "").trim();
      const viewerUuid = LISTING_ID_UUID_RX.test(viewerId) ? viewerId : null;
      const r = await pool.query(
        `SELECT c.id, c.author_id, c.author_display_name, c.author_username, c.body, c.parent_comment_id, c.created_at,
                (SELECT COALESCE(SUM(v.value), 0)::int FROM listings.community_comment_votes v WHERE v.comment_id = c.id) AS vote_count,
                (SELECT cv.value FROM listings.community_comment_votes cv
                   WHERE cv.comment_id = c.id AND $2::uuid IS NOT NULL AND cv.user_id = $2::uuid LIMIT 1) AS your_vote
         FROM listings.community_comments c
         WHERE c.post_id = $1::uuid
         ORDER BY c.created_at ASC`,
        [postId, viewerUuid],
      );
      const comments = r.rows.map((row) => {
        const c = row as Record<string, unknown>;
        const createdAt =
          c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at ?? "");
        const yv = c.your_vote;
        const yourVote =
          typeof yv === "number" && Number.isFinite(yv) ? (yv === -1 || yv === 1 ? yv : null) : null;
        const pid = c.parent_comment_id != null ? String(c.parent_comment_id).trim() : "";
        return {
          id: c.id,
          author_id: c.author_id,
          author_display_name: c.author_display_name ?? null,
          author_username: c.author_username ?? null,
          body: c.body,
          parent_comment_id: pid && LISTING_ID_UUID_RX.test(pid) ? pid : null,
          created_at: createdAt,
          voteCount: Number(c.vote_count ?? 0),
          yourVote,
        };
      });
      res.json({ comments });
    } catch (e) {
      console.error("[listings HTTP community comments list]", e);
      res.status(500).json({ error: "comments list failed" });
    }
  });

  app.get("/community/posts/:postId", async (req, res) => {
    try {
      const postId = req.params.postId || "";
      if (!LISTING_ID_UUID_RX.test(postId)) {
        res.status(400).json({ error: "invalid post id" });
        return;
      }
      const viewerId = (req.get("x-user-id") || "").trim();
      const viewerUuid = LISTING_ID_UUID_RX.test(viewerId) ? viewerId : null;
      const q = await pool.query(
        `SELECT p.id,
                p.author_id,
                p.author_display_name,
                p.author_username,
                p.title,
                p.body,
                p.flair,
                p.created_at,
                COALESCE(
                  (SELECT json_agg(json_build_object('url', i.image_url, 'alt', i.alt_text) ORDER BY i.sort_order, i.created_at)
                     FROM listings.community_post_images i
                    WHERE i.post_id = p.id),
                  '[]'::json
                ) AS images,
                (SELECT COUNT(*)::int FROM listings.community_comments c WHERE c.post_id = p.id) AS comment_count,
                (SELECT COALESCE(SUM(v.value), 0)::int FROM listings.community_post_votes v WHERE v.post_id = p.id) AS vote_count,
                (SELECT pv.value FROM listings.community_post_votes pv
                   WHERE pv.post_id = p.id AND $2::uuid IS NOT NULL AND pv.user_id = $2::uuid LIMIT 1) AS your_vote
         FROM listings.community_posts p
         WHERE p.id = $1::uuid`,
        [postId, viewerUuid],
      );
      const row = q.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const createdAt =
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
      const yv = row.your_vote;
      const yourVote =
        typeof yv === "number" && Number.isFinite(yv) ? (yv === -1 || yv === 1 ? yv : null) : null;
      res.json({
        id: row.id,
        author_id: row.author_id,
        author_display_name: row.author_display_name ?? null,
        author_username: row.author_username ?? null,
        title: row.title,
        body: row.body,
        flair: String(row.flair ?? "general"),
        images: mapCommunityImagesJson(Array.isArray(row.images) ? row.images : []),
        created_at: createdAt,
        commentCount: Number(row.comment_count ?? 0),
        voteCount: Number(row.vote_count ?? 0),
        yourVote,
      });
    } catch (e) {
      console.error("[listings HTTP community post detail]", e);
      res.status(500).json({ error: "community post failed" });
    }
  });

  app.get("/community/reports", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT r.id,
                r.reporter_id,
                r.listing_id,
                r.reason,
                r.status,
                r.created_at,
                l.title AS listing_title
         FROM listings.community_reports r
         INNER JOIN listings.listings l ON l.id = r.listing_id AND l.deleted_at IS NULL
         WHERE lower(r.status) = 'pending' AND l.user_id = $1::uuid
         ORDER BY r.created_at DESC
         LIMIT 100`,
        [req.userId!],
      );
      res.json({ reports: r.rows });
    } catch (e) {
      console.error("[listings HTTP community reports list]", e);
      res.status(500).json({ error: "reports list failed" });
    }
  });

  app.patch("/community/reports/:reportId", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const reportId = req.params.reportId || "";
      if (!LISTING_ID_UUID_RX.test(reportId)) {
        res.status(400).json({ error: "invalid report id" });
        return;
      }
      const body = req.body as { status?: unknown };
      const st = String(body.status ?? "").trim().toLowerCase();
      if (!["resolved", "dismissed"].includes(st)) {
        res.status(400).json({ error: "status must be resolved or dismissed" });
        return;
      }
      const upd = await pool.query(
        `UPDATE listings.community_reports r
         SET status = $2
         FROM listings.listings l
         WHERE r.id = $1::uuid AND r.listing_id = l.id AND l.user_id = $3::uuid AND l.deleted_at IS NULL
         RETURNING r.id, r.status`,
        [reportId, st, req.userId!],
      );
      if (!upd.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ id: (upd.rows[0] as { id: string }).id, status: (upd.rows[0] as { status: string }).status });
    } catch (e) {
      console.error("[listings HTTP community report patch]", e);
      res.status(500).json({ error: "report update failed" });
    }
  });

  app.get("/community/reports/pending-count", async (req, res) => {
    try {
      const globalMode = truthyQuery(req.query.global);
      if (globalMode) {
        const secret = (req.get("x-booking-internal-secret") || "").trim();
        if (!LISTINGS_BOOKING_INTERNAL_SECRET || secret !== LISTINGS_BOOKING_INTERNAL_SECRET) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
        const q = await pool.query(
          `SELECT COUNT(*)::int AS c FROM listings.community_reports WHERE lower(status) = 'pending'`,
        );
        res.json({ count: Number(q.rows[0]?.c ?? 0) });
        return;
      }
      const landlordId = (req.get("x-user-id") || "").trim();
      if (!LISTING_ID_UUID_RX.test(landlordId)) {
        res.status(401).json({ error: "missing x-user-id" });
        return;
      }
      const q = await pool.query(
        `SELECT COUNT(*)::int AS c
         FROM listings.community_reports r
         INNER JOIN listings.listings l ON l.id = r.listing_id AND l.deleted_at IS NULL
         WHERE lower(r.status) = 'pending' AND l.user_id = $1::uuid`,
        [landlordId],
      );
      res.json({ count: Number(q.rows[0]?.c ?? 0) });
    } catch (e) {
      console.error("[listings HTTP community reports pending-count]", e);
      res.status(500).json({ error: "pending count failed" });
    }
  });

  app.post("/community/posts", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const body = req.body as { title?: unknown; body?: unknown; flair?: unknown; images?: unknown };
      const title = String(body.title ?? "").trim();
      const text = String(body.body ?? "").trim();
      if (!title || !text) {
        res.status(400).json({ error: "title and body required" });
        return;
      }
      const imagesIn = Array.isArray(body.images) ? body.images : [];
      const images = imagesIn
        .map((raw) => {
          const obj = raw as { url?: unknown; alt?: unknown };
          const url = String(obj?.url ?? "").trim();
          if (!url) return null;
          const alt = String(obj?.alt ?? "").trim();
          return { url: url.slice(0, 2048), alt: alt ? alt.slice(0, 256) : null };
        })
        .filter((x): x is { url: string; alt: string | null } => !!x)
        .slice(0, 8);
      const flairIn = String(body.flair ?? "general").trim().toLowerCase();
      const flair = COMMUNITY_FLAIR_SET.has(flairIn) ? flairIn : "general";
      const authSnap = communityAuthorFromRequest(req);
      const ins = await pool.query(
        `INSERT INTO listings.community_posts (author_id, title, body, flair, author_display_name, author_username)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)
         RETURNING id, author_id, title, body, flair, author_display_name, author_username, created_at`,
        [
          req.userId!,
          title.slice(0, 512),
          text.slice(0, 20000),
          flair,
          authSnap.author_display_name,
          authSnap.author_username,
        ],
      );
      const row = ins.rows[0] as Record<string, unknown>;
      const createdAt =
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
      if (images.length > 0) {
        const values: unknown[] = [];
        const placeholders: string[] = [];
        for (let idx = 0; idx < images.length; idx += 1) {
          const it = images[idx]!;
          const b = idx * 4;
          placeholders.push(`($${b + 1}::uuid,$${b + 2},$${b + 3},$${b + 4}::int)`);
          values.push(String(row.id), it.url, it.alt, idx);
        }
        await pool.query(
          `INSERT INTO listings.community_post_images (post_id, image_url, alt_text, sort_order) VALUES ${placeholders.join(",")}`,
          values,
        );
      }
      void publishCommunityEvent("post.created", String(row.id), {
        version: "v1",
        post_id: String(row.id),
        author_id: String(row.author_id),
        title: String(row.title),
        body: String(row.body),
        flair: String(row.flair ?? "general"),
        created_at: createdAt,
      }).catch(() => {});
      res.status(201).json({
        id: row.id,
        author_id: row.author_id,
        author_display_name: row.author_display_name ?? null,
        author_username: row.author_username ?? null,
        title: row.title,
        body: row.body,
        flair: String(row.flair ?? "general"),
        images: mapCommunityImagesJson(images),
        created_at: createdAt,
      });
    } catch (e) {
      console.error("[listings HTTP community create post]", e);
      res.status(500).json({ error: "create post failed" });
    }
  });

  app.post("/community/posts/:postId/comments", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const postId = req.params.postId || "";
      if (!LISTING_ID_UUID_RX.test(postId)) {
        res.status(400).json({ error: "invalid post id" });
        return;
      }
      const body = req.body as { body?: unknown; parent_comment_id?: unknown };
      const text = String(body.body ?? "").trim();
      if (!text) {
        res.status(400).json({ error: "body required" });
        return;
      }
      const parentRaw = body.parent_comment_id;
      const parentId =
        parentRaw != null && String(parentRaw).trim() !== "" && LISTING_ID_UUID_RX.test(String(parentRaw))
          ? String(parentRaw)
          : null;
      const postCheck = await pool.query(
        `SELECT author_id, title, flair FROM listings.community_posts WHERE id = $1::uuid`,
        [postId],
      );
      if (!postCheck.rows[0]) {
        res.status(404).json({ error: "post not found" });
        return;
      }
      const postRow = postCheck.rows[0] as { author_id: string; title: string; flair?: string | null };
      const postAuthorId = String(postRow.author_id);
      const postTitle = String(postRow.title || "").slice(0, 512);
      const postFlair = String(postRow.flair || "general").trim().toLowerCase();
      const authSnap = communityAuthorFromRequest(req);
      const ins = await pool.query(
        `INSERT INTO listings.community_comments (post_id, author_id, parent_comment_id, body, author_display_name, author_username)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
         RETURNING id, post_id, author_id, parent_comment_id, body, author_display_name, author_username, created_at`,
        [
          postId,
          req.userId!,
          parentId,
          text.slice(0, 20000),
          authSnap.author_display_name,
          authSnap.author_username,
        ],
      );
      const row = ins.rows[0] as Record<string, unknown>;
      const createdAt =
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");
      void publishCommunityEvent("comment.created", String(row.id), {
        version: "v1",
        comment_id: String(row.id),
        post_id: String(row.post_id),
        author_id: String(row.author_id),
        parent_comment_id: row.parent_comment_id ?? null,
        body: String(row.body),
        created_at: createdAt,
      }).catch(() => {});

      const snippet = text.slice(0, 200);
      const actorUsername = authSnap.author_username ? String(authSnap.author_username).slice(0, 128) : null;
      const actorDisplay = authSnap.author_display_name ? String(authSnap.author_display_name).slice(0, 256) : null;
      const deepLink = `/community/${encodeURIComponent(postId)}?comment=${encodeURIComponent(String(row.id))}`;

      /** Top-level comment → notify post owner only. Reply → notify parent comment author only (no duplicate ping to post owner). */
      if (!parentId) {
        if (String(row.author_id) !== postAuthorId) {
          void publishCommunityEvent(`community.comment.notification`, String(row.id), {
            version: "v1",
            recipient_id: postAuthorId,
            notification_audience: postFlair === "landlord" ? "both" : "user",
            notification_category: "community",
            post_id: postId,
            post_title: postTitle,
            post_flair: postFlair,
            comment_id: String(row.id),
            parent_comment_id: null,
            actor_id: String(row.author_id),
            actor_username: actorUsername,
            actor_display_name: actorDisplay,
            snippet,
            deep_link: deepLink,
            created_at: createdAt,
          }).catch(() => {});
        }
      } else {
        const parentQ = await pool.query(
          `SELECT author_id FROM listings.community_comments WHERE id = $1::uuid AND post_id = $2::uuid LIMIT 1`,
          [parentId, postId],
        );
        const parentAuthor = parentQ.rows[0] ? String((parentQ.rows[0] as { author_id: string }).author_id) : "";
        if (parentAuthor && parentAuthor !== String(row.author_id)) {
          void publishCommunityEvent(`community.reply.notification`, String(row.id), {
            version: "v1",
            recipient_id: parentAuthor,
            notification_audience: postFlair === "landlord" ? "both" : "user",
            notification_category: "community",
            post_id: postId,
            post_title: postTitle,
            post_flair: postFlair,
            comment_id: String(row.id),
            parent_comment_id: parentId,
            actor_id: String(row.author_id),
            actor_username: actorUsername,
            actor_display_name: actorDisplay,
            snippet,
            deep_link: deepLink,
            created_at: createdAt,
          }).catch(() => {});
        }
      }

      res.status(201).json({
        id: row.id,
        post_id: row.post_id,
        author_id: row.author_id,
        author_display_name: row.author_display_name ?? null,
        author_username: row.author_username ?? null,
        parent_comment_id: row.parent_comment_id ?? null,
        body: row.body,
        created_at: createdAt,
      });
    } catch (e) {
      console.error("[listings HTTP community comment]", e);
      res.status(500).json({ error: "create comment failed" });
    }
  });

  app.delete("/community/posts/:postId", requireUser, async (req: AuthedRequest, res: Response) => {
    const userId = req.userId || "";
    const postId = String(req.params.postId || "").trim();
    if (!LISTING_ID_UUID_RX.test(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    try {
      const own = await pool.query(
        `SELECT author_id FROM listings.community_posts WHERE id = $1::uuid LIMIT 1`,
        [postId],
      );
      if (own.rows.length === 0) {
        res.status(404).json({ error: "post not found" });
        return;
      }
      if (String(own.rows[0].author_id || "") !== userId) {
        res.status(403).json({ error: "only post owner can delete" });
        return;
      }
      await pool.query(`DELETE FROM listings.community_posts WHERE id = $1::uuid`, [postId]);
      res.status(204).end();
    } catch (e) {
      console.error("[listings HTTP community delete post]", e);
      res.status(500).json({ error: "delete post failed" });
    }
  });

  app.delete(
    "/community/posts/:postId/comments/:commentId",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      const userId = req.userId || "";
      const postId = String(req.params.postId || "").trim();
      const commentId = String(req.params.commentId || "").trim();
      if (!LISTING_ID_UUID_RX.test(postId) || !LISTING_ID_UUID_RX.test(commentId)) {
        res.status(400).json({ error: "invalid id" });
        return;
      }
      try {
        const own = await pool.query(
          `SELECT author_id FROM listings.community_comments WHERE id = $1::uuid AND post_id = $2::uuid LIMIT 1`,
          [commentId, postId],
        );
        if (own.rows.length === 0) {
          res.status(404).json({ error: "comment not found" });
          return;
        }
        if (String(own.rows[0].author_id || "") !== userId) {
          res.status(403).json({ error: "only comment owner can delete" });
          return;
        }
        await pool.query(`DELETE FROM listings.community_comments WHERE id = $1::uuid`, [commentId]);
        res.status(204).end();
      } catch (e) {
        console.error("[listings HTTP community delete comment]", e);
        res.status(500).json({ error: "delete comment failed" });
      }
    },
  );

  app.post("/community/posts/:postId/vote", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const postId = req.params.postId || "";
      if (!LISTING_ID_UUID_RX.test(postId)) {
        res.status(400).json({ error: "invalid post id" });
        return;
      }
      const body = req.body as { value?: unknown };
      const v = Number(body.value);
      if (v !== 0 && v !== 1 && v !== -1) {
        res.status(400).json({ error: "value must be -1, 0, or 1" });
        return;
      }
      const postExists = await pool.query(`SELECT 1 FROM listings.community_posts WHERE id = $1::uuid`, [postId]);
      if (!postExists.rows[0]) {
        res.status(404).json({ error: "post not found" });
        return;
      }
      if (v === 0) {
        await pool.query(
          `DELETE FROM listings.community_post_votes WHERE post_id = $1::uuid AND user_id = $2::uuid`,
          [postId, req.userId!],
        );
      } else {
        await pool.query(
          `INSERT INTO listings.community_post_votes (post_id, user_id, value)
           VALUES ($1::uuid, $2::uuid, $3::smallint)
           ON CONFLICT (post_id, user_id) DO UPDATE SET value = EXCLUDED.value, created_at = now()`,
          [postId, req.userId!, v],
        );
      }
      const sum = await pool.query(
        `SELECT COALESCE(SUM(value), 0)::int AS c FROM listings.community_post_votes WHERE post_id = $1::uuid`,
        [postId],
      );
      const yv =
        v === 0
          ? null
          : (
              await pool.query(
                `SELECT value FROM listings.community_post_votes WHERE post_id = $1::uuid AND user_id = $2::uuid`,
                [postId, req.userId!],
              )
            ).rows[0]?.value;
      const yourVote = typeof yv === "number" && (yv === 1 || yv === -1) ? yv : null;
      res.json({
        voteCount: Number(sum.rows[0]?.c ?? 0),
        yourVote,
      });
    } catch (e) {
      console.error("[listings HTTP community post vote]", e);
      res.status(500).json({ error: "vote failed" });
    }
  });

  app.post(
    "/community/posts/:postId/comments/:commentId/vote",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const postId = req.params.postId || "";
        const commentId = req.params.commentId || "";
        if (!LISTING_ID_UUID_RX.test(postId) || !LISTING_ID_UUID_RX.test(commentId)) {
          res.status(400).json({ error: "invalid id" });
          return;
        }
        const body = req.body as { value?: unknown };
        const v = Number(body.value);
        if (v !== 0 && v !== 1 && v !== -1) {
          res.status(400).json({ error: "value must be -1, 0, or 1" });
          return;
        }
        const rowCheck = await pool.query(
          `SELECT c.id FROM listings.community_comments c WHERE c.id = $1::uuid AND c.post_id = $2::uuid`,
          [commentId, postId],
        );
        if (!rowCheck.rows[0]) {
          res.status(404).json({ error: "comment not found" });
          return;
        }
        if (v === 0) {
          await pool.query(
            `DELETE FROM listings.community_comment_votes WHERE comment_id = $1::uuid AND user_id = $2::uuid`,
            [commentId, req.userId!],
          );
        } else {
          await pool.query(
            `INSERT INTO listings.community_comment_votes (comment_id, user_id, value)
             VALUES ($1::uuid, $2::uuid, $3::smallint)
             ON CONFLICT (comment_id, user_id) DO UPDATE SET value = EXCLUDED.value, created_at = now()`,
            [commentId, req.userId!, v],
          );
        }
        const sum = await pool.query(
          `SELECT COALESCE(SUM(value), 0)::int AS c FROM listings.community_comment_votes WHERE comment_id = $1::uuid`,
          [commentId],
        );
        const yv =
          v === 0
            ? null
            : (
                await pool.query(
                  `SELECT value FROM listings.community_comment_votes WHERE comment_id = $1::uuid AND user_id = $2::uuid`,
                  [commentId, req.userId!],
                )
              ).rows[0]?.value;
        const yourVote = typeof yv === "number" && (yv === 1 || yv === -1) ? yv : null;
        res.json({
          voteCount: Number(sum.rows[0]?.c ?? 0),
          yourVote,
        });
      } catch (e) {
        console.error("[listings HTTP community comment vote]", e);
        res.status(500).json({ error: "vote failed" });
      }
    },
  );

  app.get("/listings/:id", async (req, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }

    try {
      const result = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      if (!result.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const row = result.rows[0] as Record<string, unknown>;
      if (!listingMarketplaceVisibleToRequester(row, requesterUserId(req))) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(await listingDetailResponsePayload(row, validation.value, requesterUserId(req)));
    } catch (e) {
      console.error("[listings HTTP get]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/listings/:id/meta", async (req, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const activeBookingCount = await getListingBookingCount(validation.value);
      res.json({ listingId: validation.value, activeBookingCount });
    } catch (e) {
      console.error("[listings HTTP meta]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/listings/:id/watch-count", async (req, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const base = (process.env.BOOKING_HTTP || "http://127.0.0.1:4013").replace(/\/$/, "");
      const url = `${base}/watchlist/listings/${encodeURIComponent(validation.value)}/count`;
      const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!upstream.ok) {
        res.status(502).json({ error: "booking upstream failed" });
        return;
      }
      const j = (await upstream.json()) as { watch_count?: number };
      const watch_count =
        typeof j.watch_count === "number" && Number.isFinite(j.watch_count)
          ? Math.max(0, Math.floor(j.watch_count))
          : 0;
      res.json({ listing_id: validation.value, watch_count });
    } catch (e) {
      console.error("[listings HTTP watch-count]", e);
      res.status(502).json({ error: "booking unreachable" });
    }
  });

  /** Marketplace-safe revision timeline (no street address, no owner UUID in payload). */
  app.get("/listings/:id/revisions/public", async (req, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const result = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      if (!result.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const row = result.rows[0] as Record<string, unknown>;
      const viewer = requesterUserId(req);
      if (!listingMarketplaceVisibleToRequester(row, viewer)) {
        res.status(404).json({ error: "not found" });
        return;
      }
      let r;
      try {
        r = await pool.query(
          `SELECT id, editor_user_id, changes, created_at
           FROM listings.listing_revisions
           WHERE listing_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 80`,
          [validation.value],
        );
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === "42703") {
          r = await pool.query(
            `SELECT id, editor_user_id, created_at
             FROM listings.listing_revisions
             WHERE listing_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT 80`,
            [validation.value],
          );
        } else {
          throw e;
        }
      }
      const items = r.rows.map((raw) => {
        const rec = raw as Record<string, unknown>;
        const id = String(rec.id ?? "");
        const created_at = String(rec.created_at ?? "");
        const editorId = String(rec.editor_user_id ?? "");
        const hasChanges = Object.prototype.hasOwnProperty.call(rec, "changes");
        const ch = hasChanges ? rec.changes : undefined;
        const safeChanges =
          hasChanges && ch != null ? sanitizePublicRevisionChanges(ch) ?? ({} as Record<string, unknown>) : null;
        const lines = safeChanges != null ? publicRevisionLinesFromChanges(safeChanges) : ["Listing updated"];
        const editor_display =
          viewer && editorId && viewer === editorId ? "You (host)" : "Host updated this listing";
        return { id, created_at, editor_display, lines };
      });
      res.json({ revision_count: items.length, items });
    } catch (e) {
      console.error("[listings HTTP revisions public]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/listings/:id/revisions", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const own = await pool.query(
        `SELECT user_id FROM listings.listings WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
        [validation.value],
      );
      if (!own.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      if (String(own.rows[0].user_id) !== String(req.userId || "")) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      let r;
      try {
        r = await pool.query(
          `SELECT id, editor_user_id, snapshot, changes, created_at
           FROM listings.listing_revisions
           WHERE listing_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 100`,
          [validation.value],
        );
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === "42703") {
          r = await pool.query(
            `SELECT id, editor_user_id, snapshot, created_at
             FROM listings.listing_revisions
             WHERE listing_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT 100`,
            [validation.value],
          );
        } else {
          throw e;
        }
      }
      res.json({ items: r.rows });
    } catch (e) {
      console.error("[listings HTTP revisions]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.patch("/listings/:id/status", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const body =
      req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const stRaw = String(body.status ?? "").trim().toLowerCase();
    if (!LANDLORD_LISTING_STATUS_SET.has(stRaw)) {
      res.status(400).json({ error: "status must be active, paused, or archived" });
      return;
    }
    const newStatus = stRaw as "active" | "paused" | "archived";
    try {
      const cur = await pool.query(
        `SELECT id, user_id, status::text AS status FROM listings.listings
         WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
        [validation.value],
      );
      const row = cur.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        res.status(404).json({ error: "not found" });
        return;
      }
      if (String(row.user_id) !== String(req.userId || "")) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const previous = String(row.status ?? "").toLowerCase();
      if (previous === "archived" || previous === "closed") {
        res.status(409).json({
          error: "listing is permanently removed; status cannot be changed",
        });
        return;
      }
      if (previous === "flagged" && newStatus === "active") {
        res.status(403).json({ error: "cannot reactivate a flagged listing" });
        return;
      }
      if (newStatus === "active") {
        const img = await pool.query(
          `SELECT COUNT(*)::int AS image_count FROM listings.listing_media
           WHERE listing_id = $1::uuid AND media_type = 'image'`,
          [validation.value],
        );
        const imageCount = Number((img.rows[0] as { image_count?: number })?.image_count ?? 0);
        if (!Number.isFinite(imageCount) || imageCount < 1) {
          res.status(400).json({
            error: "at least one image is required before publishing (status active)",
          });
          return;
        }
      }
      const upd = await pool.query(
        `UPDATE listings.listings
         SET status = $2::listings.listing_status, version = version + 1, updated_at = now()
         WHERE id = $1::uuid AND user_id = $3::uuid AND deleted_at IS NULL
         RETURNING id, status::text AS status, version`,
        [validation.value, newStatus, req.userId],
      );
      if (!upd.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const nextRow = upd.rows[0] as Record<string, unknown>;
      if (previous !== newStatus) {
        try {
          await publishListingEventForCreateResponse(
            "ListingStatusUpdatedV1",
            validation.value,
            {
              listing_id: validation.value,
              previous_status: previous,
              new_status: newStatus,
            },
          );
        } catch (e) {
          console.error("[listings HTTP status] kafka", e);
          res.status(503).json({ error: "listing event publish failed" });
          return;
        }
      }
      res.json({ id: nextRow.id, status: nextRow.status, version: nextRow.version });
    } catch (e) {
      console.error("[listings HTTP patch status]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  /** Landlord: edit core listing fields; persists an append-only revision row. */
  app.patch("/listings/:id", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
        `SELECT l.id, l.user_id, l.title, l.description, l.price_cents, l.amenities,
                l.smoke_free, l.pet_friendly, l.furnished, l.status::text AS status,
                l.latitude, l.longitude, l.display_location, l.effective_from, l.effective_until,
                l.listed_at, l.created_at, l.updated_at, l.version,
                l.residence_type, l.size_sqft, l.address_line1, l.address_line2, l.city,
                l.state_or_province, l.postal_code, l.country, l.neighborhood, l.bedrooms, l.bathrooms,
                COALESCE(l.pricing_mode::text, 'fixed') AS pricing_mode,
                l.soft_hold_until
         FROM listings.listings l
         WHERE l.id = $1::uuid AND l.deleted_at IS NULL
         FOR UPDATE`,
        [validation.value],
      );
      const row = cur.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "not found" });
        return;
      }
      if (String(row.user_id) !== String(req.userId || "")) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const st = String(row.status ?? "").toLowerCase();
      if (st === "archived" || st === "closed" || st === "flagged") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "listing cannot be edited in this status" });
        return;
      }

      let title = String(row.title ?? "");
      let description = String(row.description ?? "");
      let price_cents = Number(row.price_cents ?? 0);
      let amenities: unknown = row.amenities;
      let smoke_free = Boolean(row.smoke_free);
      let pet_friendly = Boolean(row.pet_friendly);
      let furnished = Boolean(row.furnished);
      let display_location =
        row.display_location == null ? null : String(row.display_location);
      let latitude = row.latitude == null ? null : Number(row.latitude);
      let longitude = row.longitude == null ? null : Number(row.longitude);
      let effective_from =
        row.effective_from instanceof Date
          ? row.effective_from.toISOString().slice(0, 10)
          : String(row.effective_from ?? "").slice(0, 10);
      let effective_until: string | null =
        row.effective_until == null
          ? null
          : row.effective_until instanceof Date
            ? row.effective_until.toISOString().slice(0, 10)
            : String(row.effective_until).slice(0, 10);

      let residence_type =
        row.residence_type == null ? "apartment" : String(row.residence_type).toLowerCase();
      let size_sqft =
        row.size_sqft != null && Number.isFinite(Number(row.size_sqft))
          ? Math.floor(Number(row.size_sqft))
          : null;
      let address_line1 = row.address_line1 == null ? null : String(row.address_line1).slice(0, 240);
      let address_line2 = row.address_line2 == null ? null : String(row.address_line2).slice(0, 240);
      let city = row.city == null ? null : String(row.city).slice(0, 120);
      let state_or_province =
        row.state_or_province == null ? null : String(row.state_or_province).slice(0, 80);
      let postal_code = row.postal_code == null ? null : String(row.postal_code).slice(0, 32);
      let country = row.country == null ? null : String(row.country).slice(0, 80);
      let neighborhood = row.neighborhood == null ? null : String(row.neighborhood).slice(0, 160);
      let bedrooms =
        row.bedrooms != null && Number.isFinite(Number(row.bedrooms))
          ? Math.min(20, Math.max(0, Math.floor(Number(row.bedrooms))))
          : null;
      let bathrooms =
        row.bathrooms != null && Number.isFinite(Number(row.bathrooms))
          ? Math.min(20, Math.max(0, Number(row.bathrooms)))
          : null;

      let pricing_mode = String(row.pricing_mode ?? "fixed").trim().toLowerCase();
      if (pricing_mode !== "fixed" && pricing_mode !== "obo") pricing_mode = "fixed";
      let soft_hold_until: string | null =
        row.soft_hold_until instanceof Date
          ? row.soft_hold_until.toISOString()
          : row.soft_hold_until != null && String(row.soft_hold_until).trim()
            ? String(row.soft_hold_until).trim()
            : null;

      if (body.title !== undefined) title = String(body.title ?? "").trim().slice(0, 512);
      if (body.description !== undefined) description = String(body.description ?? "").trim().slice(0, 20000);
      if (body.price_cents !== undefined || body.price !== undefined) {
        const p = body.price_cents ?? body.price;
        const n = typeof p === "number" ? p : Number(p);
        if (!Number.isFinite(n) || n < 0) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "invalid price_cents" });
          return;
        }
        price_cents = Math.floor(n);
      }
      if (body.amenities !== undefined) {
        amenities = amenitiesToStrings(body.amenities);
      }
      if (body.smoke_free !== undefined) smoke_free = Boolean(body.smoke_free);
      if (body.pet_friendly !== undefined) pet_friendly = Boolean(body.pet_friendly);
      if (body.furnished !== undefined) furnished = Boolean(body.furnished);
      if (body.display_location !== undefined) {
        const d = normalizeOptStr(body.display_location);
        display_location = d ? d.slice(0, 240) : null;
      }
      if (body.latitude !== undefined) {
        const lat = body.latitude;
        latitude =
          lat != null && lat !== "" && Number.isFinite(Number(lat)) ? Number(lat) : null;
      }
      if (body.longitude !== undefined) {
        const lng = body.longitude;
        longitude =
          lng != null && lng !== "" && Number.isFinite(Number(lng)) ? Number(lng) : null;
      }
      if (body.effective_from !== undefined) {
        const s = parseYmdFromBody(body.effective_from);
        effective_from = s || effective_from;
      }
      if (body.effective_until !== undefined) {
        if (body.effective_until === null || body.effective_until === "") effective_until = null;
        else effective_until = parseYmdFromBody(body.effective_until);
      }
      if (body.residence_type !== undefined) {
        const rt = normalizeResidenceType(body.residence_type);
        if (!rt) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "invalid residence_type" });
          return;
        }
        residence_type = rt;
      }
      if (body.size_sqft !== undefined || body.square_feet !== undefined) {
        const raw = body.size_sqft ?? body.square_feet;
        if (raw === null || raw === "") size_sqft = null;
        else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) {
            await client.query("ROLLBACK");
            res.status(400).json({ error: "invalid size_sqft" });
            return;
          }
          size_sqft = Math.min(1_000_000, Math.floor(n));
        }
      }
      if (body.address_line1 !== undefined) {
        const s = normalizeOptStr(body.address_line1);
        address_line1 = s ? s.slice(0, 240) : null;
      }
      if (body.address_line2 !== undefined) {
        const s = normalizeOptStr(body.address_line2);
        address_line2 = s ? s.slice(0, 240) : null;
      }
      if (body.city !== undefined) {
        const s = normalizeOptStr(body.city);
        city = s ? s.slice(0, 120) : null;
      }
      if (body.state_or_province !== undefined || body.state !== undefined || body.region !== undefined) {
        const s = normalizeOptStr(body.state_or_province ?? body.state ?? body.region);
        state_or_province = s ? s.slice(0, 80) : null;
      }
      if (body.postal_code !== undefined || body.zip !== undefined) {
        const s = normalizeOptStr(body.postal_code ?? body.zip);
        postal_code = s ? s.slice(0, 32) : null;
      }
      if (body.country !== undefined) {
        const s = normalizeOptStr(body.country);
        country = s ? s.slice(0, 80) : null;
      }
      if (body.neighborhood !== undefined) {
        const s = normalizeOptStr(body.neighborhood);
        neighborhood = s ? s.slice(0, 160) : null;
      }
      if (body.bedrooms !== undefined) {
        if (body.bedrooms === null || body.bedrooms === "") bedrooms = null;
        else {
          const n = Number(body.bedrooms);
          if (!Number.isFinite(n) || n < 0 || n > 20) {
            await client.query("ROLLBACK");
            res.status(400).json({ error: "invalid bedrooms" });
            return;
          }
          bedrooms = Math.floor(n);
        }
      }
      if (body.bathrooms !== undefined) {
        if (body.bathrooms === null || body.bathrooms === "") bathrooms = null;
        else {
          const n = Number(body.bathrooms);
          if (!Number.isFinite(n) || n <= 0 || n > 20) {
            await client.query("ROLLBACK");
            res.status(400).json({ error: "invalid bathrooms" });
            return;
          }
          bathrooms = Math.round(n * 10) / 10;
        }
      }

      if (body.pricing_mode !== undefined) {
        const pm = String(body.pricing_mode ?? "").trim().toLowerCase();
        if (pm !== "fixed" && pm !== "obo") {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "pricing_mode must be fixed or obo" });
          return;
        }
        pricing_mode = pm;
      }
      if (body.soft_hold_until !== undefined) {
        if (body.soft_hold_until === null || body.soft_hold_until === "") {
          soft_hold_until = null;
        } else {
          const d = new Date(String(body.soft_hold_until));
          if (Number.isNaN(d.getTime())) {
            await client.query("ROLLBACK");
            res.status(400).json({ error: "soft_hold_until must be ISO-8601 timestamp or null" });
            return;
          }
          soft_hold_until = d.toISOString();
        }
      }

      if (!title) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "title required" });
        return;
      }

      const afterFields: Record<string, unknown> = {
        title,
        description,
        price_cents,
        amenities,
        smoke_free,
        pet_friendly,
        furnished,
        display_location,
        latitude,
        longitude,
        effective_from,
        effective_until: effective_until || null,
        residence_type,
        size_sqft,
        address_line1,
        address_line2,
        city,
        state_or_province,
        postal_code,
        country,
        neighborhood,
        bedrooms,
        bathrooms,
        pricing_mode,
        soft_hold_until,
      };
      const revisionChanges = computeListingRevisionChanges(row as Record<string, unknown>, afterFields);

      try {
        try {
          await client.query(
            `INSERT INTO listings.listing_revisions (listing_id, editor_user_id, snapshot, changes)
             VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::jsonb)`,
            [validation.value, req.userId!, JSON.stringify(row), JSON.stringify(revisionChanges)],
          );
        } catch (e: unknown) {
          const code = (e as { code?: string })?.code;
          if (code === "42703") {
            await client.query(
              `INSERT INTO listings.listing_revisions (listing_id, editor_user_id, snapshot)
               VALUES ($1::uuid, $2::uuid, $3::jsonb)`,
              [validation.value, req.userId!, JSON.stringify(row)],
            );
          } else {
            throw e;
          }
        }
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "42P01") {
          await client.query("ROLLBACK");
          res.status(501).json({ error: "listing_revisions table missing; run migration 17-listing-revisions.sql" });
          return;
        }
        throw e;
      }

      const amenitiesJson =
        typeof amenities === "string" ? amenities : JSON.stringify(amenitiesToStrings(amenities));

      await client.query(
        `UPDATE listings.listings SET
           title = $2,
           description = $3,
           price_cents = $4,
           amenities = $5::jsonb,
           smoke_free = $6,
           pet_friendly = $7,
           furnished = $8,
           display_location = $9,
           latitude = $10,
           longitude = $11,
           effective_from = NULLIF($12, '')::date,
           effective_until = NULLIF($13, '')::date,
           residence_type = $14::text,
           size_sqft = $15::int,
           address_line1 = $16,
           address_line2 = $17,
           city = $18,
           state_or_province = $19,
           postal_code = $20,
           country = $21,
           neighborhood = $22,
           bedrooms = $23::int,
           bathrooms = $24::numeric,
           pricing_mode = $27::text,
           soft_hold_until = $28::timestamptz,
           username_display = COALESCE(NULLIF(TRIM($26::text), ''), username_display),
           version = version + 1,
           updated_at = now()
         WHERE id = $1::uuid AND user_id = $25::uuid AND deleted_at IS NULL`,
        [
          validation.value,
          title,
          description,
          price_cents,
          amenitiesJson,
          smoke_free,
          pet_friendly,
          furnished,
          display_location,
          latitude,
          longitude,
          effective_from,
          effective_until || null,
          residence_type,
          size_sqft,
          address_line1,
          address_line2,
          city,
          state_or_province,
          postal_code,
          country,
          neighborhood,
          bedrooms,
          bathrooms,
          req.userId!,
          listingHostDisplayFromHeaders(req) || "",
          pricing_mode,
          soft_hold_until,
        ],
      );
      await client.query("COMMIT");
      const out = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      const detail = out.rows[0] as Record<string, unknown> | undefined;
      if (!detail) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(await listingDetailResponsePayload(detail, validation.value, req.userId!));
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      console.error("[listings HTTP patch listing]", e);
      res.status(500).json({ error: "internal" });
    } finally {
      client.release();
    }
  });

  /**
   * Landlord: soft-delete own listing (removed from marketplace; row retained for analytics).
   * Records a revision row when the revisions table supports `changes` jsonb.
   */
  app.delete("/listings/:id", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
        `SELECT id, user_id, deleted_at FROM listings.listings WHERE id = $1::uuid LIMIT 1 FOR UPDATE`,
        [validation.value],
      );
      const row = cur.rows[0] as { id?: string; user_id?: string; deleted_at?: Date | null } | undefined;
      if (!row || row.deleted_at != null) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "not found" });
        return;
      }
      if (String(row.user_id) !== String(req.userId || "")) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "forbidden" });
        return;
      }
      try {
        await insertListingRevisionEntry(client, validation.value, req.userId!, {
          listing_event: { action: "soft_deleted", at: new Date().toISOString() },
        });
      } catch (revErr) {
        console.warn("[listings HTTP delete listing] revision skipped", revErr);
      }
      await client.query(
        `UPDATE listings.listings
         SET deleted_at = now(),
             version = version + 1,
             updated_at = now(),
             status = 'archived'::listings.listing_status
         WHERE id = $1::uuid AND user_id = $2::uuid AND deleted_at IS NULL`,
        [validation.value, req.userId],
      );
      await client.query("COMMIT");
      res.json({ ok: true, id: validation.value });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      console.error("[listings HTTP delete listing]", e);
      res.status(500).json({ error: "internal" });
    } finally {
      client.release();
    }
  });

  /** E2E / ops: Redis-backed active booking count (same key as GET …/meta). */
  app.get("/debug/redis-booking-count/:id", async (req, res) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const redis_booking_count = await getListingBookingCount(validation.value);
      res.json({ listingId: validation.value, redis_booking_count });
    } catch (e) {
      console.error("[listings HTTP debug redis-booking-count]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/listings/:id/media", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const mediaUrlRaw = String((req.body as { media_url?: unknown; url_or_path?: unknown; url?: unknown }).media_url ?? (req.body as { media_url?: unknown; url_or_path?: unknown; url?: unknown }).url_or_path ?? (req.body as { media_url?: unknown; url_or_path?: unknown; url?: unknown }).url ?? "").trim();
    const mediaTypeRaw = String((req.body as { media_type?: unknown }).media_type ?? "image").trim().toLowerCase();
    const sortOrderBody = (req.body as { sort_order?: unknown }).sort_order;
    if (!mediaUrlRaw) {
      res.status(400).json({ error: "media_url is required" });
      return;
    }
    if (mediaTypeRaw !== "image" && mediaTypeRaw !== "video") {
      res.status(400).json({ error: "media_type must be image or video" });
      return;
    }
    if (mediaTypeRaw === "image") {
      const shape = validateListingImageUrlShape(mediaUrlRaw);
      if (!shape.ok) {
        res.status(400).json({ error: shape.message });
        return;
      }
      const strict =
        process.env.LISTINGS_MEDIA_STRICT === "1" || process.env.LISTINGS_MEDIA_STRICT === "true";
      if (strict) {
        const head = await validateListingImageUrlHead(mediaUrlRaw);
        if (!head.ok) {
          res.status(400).json({ error: head.message });
          return;
        }
      }
    } else if (mediaTypeRaw === "video") {
      const vidOk =
        /^https:\/\//i.test(mediaUrlRaw) ||
        mediaUrlRaw.startsWith("/api/media/") ||
        mediaUrlRaw.startsWith("/media/");
      if (!vidOk) {
        res.status(400).json({ error: "video url must be https or an OCH /api/media/... path" });
        return;
      }
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(
        `SELECT user_id FROM listings.listings WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [validation.value],
      );
      if (!owner.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "listing not found" });
        return;
      }
      if (String(owner.rows[0].user_id) !== String(req.userId || "")) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "forbidden" });
        return;
      }
      let sortOrder = 0;
      if (sortOrderBody !== undefined && sortOrderBody !== null && String(sortOrderBody).trim() !== "") {
        const sortOrderRaw = Number(sortOrderBody);
        sortOrder =
          Number.isFinite(sortOrderRaw) && sortOrderRaw >= 0 ? Math.floor(sortOrderRaw) : 0;
      } else {
        const mx = await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM listings.listing_media WHERE listing_id = $1::uuid`,
          [validation.value],
        );
        const n = Number((mx.rows[0] as { n?: unknown })?.n ?? 0);
        sortOrder = Number.isFinite(n) ? Math.floor(n) : 0;
      }
      const insert = await client.query(
        `INSERT INTO listings.listing_media (listing_id, media_type, url_or_path, sort_order)
         VALUES ($1::uuid, $2, $3, $4)
         RETURNING id, listing_id, media_type, url_or_path, sort_order, created_at`,
        [validation.value, mediaTypeRaw, mediaUrlRaw, sortOrder],
      );
      try {
        await insertListingRevisionEntry(client, validation.value, req.userId!, {
          media_event: {
            from: null,
            to: {
              action: "added",
              media_type: mediaTypeRaw,
              url: mediaUrlRaw.slice(0, 500),
              media_id: String((insert.rows[0] as { id?: unknown }).id ?? ""),
            },
          },
        });
      } catch (revErr) {
        console.warn("[listings HTTP attach media] revision skipped", revErr);
      }
      await client.query("COMMIT");
      const out = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      const detail = out.rows[0] as Record<string, unknown> | undefined;
      if (!detail) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.status(201).json({
        media: insert.rows[0],
        listing: await listingDetailResponsePayload(detail, validation.value, req.userId!),
      });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      console.error("[listings HTTP attach media]", e);
      res.status(500).json({ error: "internal" });
    } finally {
      client.release();
    }
  });

  app.delete("/listings/:id/media/:mediaId", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const mediaId = String(req.params.mediaId || "").trim();
    if (!LISTING_ID_UUID_RX.test(mediaId)) {
      res.status(400).json({ error: "invalid media id" });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(
        `SELECT user_id FROM listings.listings WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [validation.value],
      );
      if (!owner.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "listing not found" });
        return;
      }
      if (String(owner.rows[0].user_id) !== String(req.userId || "")) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const cur = await client.query(
        `SELECT id, url_or_path, media_type FROM listings.listing_media
         WHERE id = $1::uuid AND listing_id = $2::uuid LIMIT 1`,
        [mediaId, validation.value],
      );
      const row = cur.rows[0] as { url_or_path?: string; media_type?: string } | undefined;
      if (!row) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "media not found" });
        return;
      }
      await client.query(`DELETE FROM listings.listing_media WHERE id = $1::uuid AND listing_id = $2::uuid`, [
        mediaId,
        validation.value,
      ]);
      try {
        await insertListingRevisionEntry(client, validation.value, req.userId!, {
          media_event: {
            from: {
              action: "removed",
              media_id: mediaId,
              media_type: String(row.media_type ?? ""),
              url: String(row.url_or_path ?? "").slice(0, 500),
            },
            to: null,
          },
        });
      } catch (revErr) {
        console.warn("[listings HTTP delete media] revision skipped", revErr);
      }
      await client.query("COMMIT");
      const out = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      const detail = out.rows[0] as Record<string, unknown> | undefined;
      if (!detail) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ ok: true, listing: await listingDetailResponsePayload(detail, validation.value, req.userId!) });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      console.error("[listings HTTP delete media]", e);
      res.status(500).json({ error: "internal" });
    } finally {
      client.release();
    }
  });

  app.patch("/listings/:id/media-order", requireUser, async (req: AuthedRequest, res: Response) => {
    const validation = validateListingId(req.params.id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const rawIds = body.ordered_media_ids ?? body.media_ids ?? body.order;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      res.status(400).json({ error: "ordered_media_ids array required" });
      return;
    }
    const orderedIds = rawIds.map((x) => String(x).trim()).filter((id) => LISTING_ID_UUID_RX.test(id));
    if (!orderedIds.length) {
      res.status(400).json({ error: "ordered_media_ids must contain valid UUIDs" });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(
        `SELECT user_id FROM listings.listings WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [validation.value],
      );
      if (!owner.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "listing not found" });
        return;
      }
      if (String(owner.rows[0].user_id) !== String(req.userId || "")) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const existing = await client.query(
        `SELECT id::text FROM listings.listing_media WHERE listing_id = $1::uuid`,
        [validation.value],
      );
      const existingSet = new Set(existing.rows.map((r) => String((r as { id?: string }).id)));
      if (orderedIds.length !== existingSet.size) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: "ordered_media_ids must list every media item for this listing exactly once",
        });
        return;
      }
      const uniq = new Set(orderedIds);
      if (uniq.size !== orderedIds.length) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "duplicate ids in ordered_media_ids" });
        return;
      }
      for (const id of orderedIds) {
        if (!existingSet.has(id)) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "ordered_media_ids must match this listing's media only" });
          return;
        }
      }
      for (let i = 0; i < orderedIds.length; i += 1) {
        await client.query(
          `UPDATE listings.listing_media SET sort_order = $3 WHERE listing_id = $1::uuid AND id = $2::uuid`,
          [validation.value, orderedIds[i], i],
        );
      }
      try {
        await insertListingRevisionEntry(client, validation.value, req.userId!, {
          media_event: {
            from: null,
            to: { action: "reordered", ordered_media_ids: orderedIds },
          },
        });
      } catch (revErr) {
        console.warn("[listings HTTP media-order] revision skipped", revErr);
      }
      await client.query("COMMIT");
      const out = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      const detail = out.rows[0] as Record<string, unknown> | undefined;
      if (!detail) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ ok: true, listing: await listingDetailResponsePayload(detail, validation.value, req.userId!) });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      console.error("[listings HTTP media-order]", e);
      res.status(500).json({ error: "internal" });
    } finally {
      client.release();
    }
  });

  app.post(
    "/listings/:id/save",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      const validation = validateListingId(req.params.id);
      if (!validation.ok) {
        res.status(400).json({ error: validation.message });
        return;
      }
      try {
        const out = await proxyBookingWatchlist(
          req.userId!,
          validation.value,
          false,
        );
        if (out.status === 401) {
          res.status(401).json({ error: "booking upstream rejected auth" });
          return;
        }
        if (!out.ok && out.status >= 500) {
          res.status(502).json({ error: "booking upstream failed", detail: out.body });
          return;
        }
        res.status(201).json({
          listing_id: validation.value,
          saved: true,
          watchlist: out.body,
        });
      } catch (e) {
        console.error("[listings HTTP save]", e);
        res.status(502).json({ error: "booking unreachable" });
      }
    },
  );

  app.delete(
    "/listings/:id/save",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      const validation = validateListingId(req.params.id);
      if (!validation.ok) {
        res.status(400).json({ error: validation.message });
        return;
      }
      try {
        const out = await proxyBookingWatchlist(
          req.userId!,
          validation.value,
          true,
        );
        if (out.status === 401) {
          res.status(401).json({ error: "booking upstream rejected auth" });
          return;
        }
        if (!out.ok && out.status >= 500) {
          res.status(502).json({ error: "booking upstream failed", detail: out.body });
          return;
        }
        res.json({
          listing_id: validation.value,
          saved: false,
          watchlist: out.body,
        });
      } catch (e) {
        console.error("[listings HTTP unsave]", e);
        res.status(502).json({ error: "booking unreachable" });
      }
    },
  );

  app.post(
    "/create",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        // validate first, outside risky logic
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
        const incomingImagesEarly = Array.isArray((body as { images?: unknown[] }).images)
          ? ((body as { images?: unknown[] }).images ?? []).map(String).map((v) => v.trim()).filter(Boolean)
          : [];
        const singleImageEarly = String(
          (body as { image_url?: unknown; primaryImageUrl?: unknown }).image_url ??
            (body as { image_url?: unknown; primaryImageUrl?: unknown }).primaryImageUrl ??
            "",
        ).trim();
        const imagesEarly = Array.from(
          new Set([...(singleImageEarly ? [singleImageEarly] : []), ...incomingImagesEarly]),
        );
        if (imagesEarly.length < 1) {
          res.status(400).json({
            error:
              "at least one image URL is required (https CDN or /api/media/... paths from uploads; images[] or image_url / primaryImageUrl)",
          });
          return;
        }
        if (imagesEarly.length > MAX_LISTING_IMAGES_PER_CREATE) {
          res.status(400).json({
            error: `at most ${MAX_LISTING_IMAGES_PER_CREATE} images allowed`,
          });
          return;
        }
        const mediaCheck = await validateListingImageUrlsForCreate(imagesEarly);
        if (!mediaCheck.ok) {
          res.status(400).json({ error: mediaCheck.message });
          return;
        }
        // THEN do DB / side effects inside try
        const input = validation.value;
        const bodyRec = body as Record<string, unknown>;
        const rawInit = String(bodyRec.initial_status ?? bodyRec.listing_status ?? "active")
          .trim()
          .toLowerCase();
        const initialListingStatus = rawInit === "paused" ? "paused" : "active";
        const latRaw = body.latitude;
        const lngRaw = body.longitude;
        let lat =
          latRaw != null && latRaw !== "" && Number.isFinite(Number(latRaw))
            ? Number(latRaw)
            : null;
        let lng =
          lngRaw != null && lngRaw !== "" && Number.isFinite(Number(lngRaw))
            ? Number(lngRaw)
            : null;
        let displayLocation = buildDisplayLocationForCreate(bodyRec, lat, lng, input.title);
        if (
          (lat == null || lng == null) &&
          input.address_line1 &&
          input.city &&
          input.state_or_province &&
          input.country
        ) {
          const g = await geocodeStructuredAddress({
            address_line1: input.address_line1,
            address_line2: input.address_line2,
            city: input.city,
            state_or_province: input.state_or_province,
            postal_code: input.postal_code,
            country: input.country,
          });
          if (g) {
            lat = g.lat;
            lng = g.lng;
          }
          displayLocation =
            buildDisplayLocationForCreate(bodyRec, lat, lng, input.title) ?? displayLocation;
        }

        const hostLabel = listingHostDisplayFromHeaders(req);

        const r = await pool.query(
          `INSERT INTO listings.listings (
          user_id, username_display, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
          effective_from, effective_until, listed_at, latitude, longitude, display_location,
          residence_type, size_sqft, address_line1, address_line2, city, state_or_province, postal_code, country, neighborhood,
          bedrooms, bathrooms, status
        ) VALUES (
$1::uuid, NULLIF(TRIM($2::text), ''), $3, $4, $5, $6::jsonb, $7, $8, $9,
$10::date, NULLIF($11,'')::date, CURRENT_DATE,
$12, $13, $14,
$15::text, $16::int,
$17, $18, $19, $20, $21, $22, $23,
$24::int, $25::numeric, $26::listings.listing_status
) RETURNING id, user_id, title, description, price_cents,
          amenities, smoke_free, pet_friendly, furnished,
          status::text AS status, created_at,
          listed_at, latitude, longitude, display_location,
          residence_type, size_sqft, address_line1, address_line2, city, state_or_province, postal_code, country, neighborhood,
          bedrooms, bathrooms`,
          [
            input.user_id,
            hostLabel || "",
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
            displayLocation,
            input.residence_type,
            input.size_sqft,
            input.address_line1,
            input.address_line2,
            input.city,
            input.state_or_province,
            input.postal_code,
            input.country,
            input.neighborhood,
            input.bedrooms,
            input.bathrooms,
            initialListingStatus,
          ],
        );

        const row = r.rows[0];

        // Media wiring at create-time (required URLs validated above).
        const incomingImages = incomingImagesEarly;
        const singleImage = singleImageEarly;
        const images = imagesEarly;
        if (images.length > 0) {
          const listingId = String(row.id);
          for (let idx = 0; idx < images.length; idx += 1) {
            await pool.query(
              `INSERT INTO listings.listing_media (listing_id, media_type, url_or_path, sort_order)
               VALUES ($1::uuid, 'image', $2, $3)
               ON CONFLICT DO NOTHING`,
              [listingId, images[idx], idx],
            );
          }
        }

        try {
          const snap = await pool.query(
            `SELECT row_to_json(s)::jsonb AS snapshot FROM (SELECT * FROM listings.listings WHERE id = $1::uuid) s`,
            [String(row.id)],
          );
          const snapshot = snap.rows[0]?.snapshot;
          if (snapshot && req.userId) {
            try {
              await pool.query(
                `INSERT INTO listings.listing_revisions (listing_id, editor_user_id, snapshot, changes)
                 VALUES ($1::uuid, $2::uuid, $3::jsonb, NULL::jsonb)`,
                [String(row.id), req.userId, snapshot],
              );
            } catch (colErr: unknown) {
              if ((colErr as { code?: string })?.code === "42703") {
                await pool.query(
                  `INSERT INTO listings.listing_revisions (listing_id, editor_user_id, snapshot)
                   VALUES ($1::uuid, $2::uuid, $3::jsonb)`,
                  [String(row.id), req.userId, snapshot],
                );
              } else {
                throw colErr;
              }
            }
          }
        } catch (revErr) {
          console.warn("[listings HTTP create] listing_revisions insert skipped", revErr);
        }

        const eventId = randomUUID();
        const listedDay =
          formatListedAt(row) || new Date().toISOString().slice(0, 10);

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

        try {
          await publishListingEventForCreateResponse(
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
        } catch (e) {
          console.error("[listings HTTP create] kafka", e);
          res.status(503).json({ error: "listing event publish failed" });
          return;
        }

        fireSavedSearchNotifyForNewListing({
          listing_id: String(row.id),
          landlord_user_id: String(row.user_id),
          title: String(row.title),
          price_cents: Number(row.price_cents),
          residence_type: input.residence_type,
          size_sqft: input.size_sqft,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          latitude: lat,
          longitude: lng,
          status: String(row.status),
        });

        const primaryForResponse = images.length > 0 ? images[0]! : null;
        res.status(201).json(
          rowToJson({
            ...row,
            primary_image_url: primaryForResponse,
          }),
        );
      } catch (e) {
        console.error("[listings HTTP create]", e);
        res.status(500).json({ error: "internal" });
      }
    },
  );

  /** Gateway alias: GET /api/listings/:uuid → upstream GET /:uuid */
  app.get("/:id", async (req, res) => {
    const id = req.params.id;
    if (!LISTING_ID_UUID_RX.test(id)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const validation = validateListingId(id);
    if (!validation.ok) {
      res.status(400).json({ error: validation.message });
      return;
    }
    try {
      const result = await pool.query(LISTINGS_DETAIL_SQL, [validation.value]);
      if (!result.rows[0]) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const row = result.rows[0] as Record<string, unknown>;
      if (!listingMarketplaceVisibleToRequester(row, requesterUserId(req))) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(await listingDetailResponsePayload(row, validation.value, requesterUserId(req)));
    } catch (e) {
      console.error("[listings HTTP get by uuid alias]", e);
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
