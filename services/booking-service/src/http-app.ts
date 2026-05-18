import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { kafka, register, httpCounter, createHttpConcurrencyGuard, initOchOutboxSurfaceUnsupported } from "@common/utils";
import {
  buildKafkaMessageHeaders,
  getIncomingHttpOtelContext,
  inferNetProtoForSpan,
  mountDebugTraceHeaders,
  tracingMiddleware,
  withKafkaProduceSpan,
} from "@common/utils/otel";
import { Prisma, type Booking } from "../prisma/generated/client/index.js";
import { prisma } from "./lib/prisma.js";
import { randomUUID } from "node:crypto";
import { BOOKING_EVENTS_TOPIC } from "./grpc-server.js";
import {
  acquireListingSoftLock,
  computeFraudScore,
  decrementListingBookingCount,
  fraudFactorsToSignals,
  incrementListingBookingCount,
  isTenantBookingBanned,
  persistTenantBookingBan,
  releaseListingSoftLock,
} from "./booking-realtime.js";
import {
  bookingExpiredTotal,
  bookingFraudFlaggedTotal,
  bookingRequestsTotal,
  recordBookingEnteredDomainStatus,
} from "./booking-metrics.js";
import { fetchListingMetaForBookingRequest } from "./listing-request-meta.js";
import { publishTrustEvent } from "./trust-events.js";
import {
  cleanUsernameIdentityBase,
  tenantOwnsBooking,
} from "./booking-tenant-ownership.js";
import {
  isIntegrationBookingRow,
  listingCardFromBookingSnapshot,
  resolveListingCard,
} from "./listing-enrichment.js";
import { notifyLandlordBookingRequestHttp } from "./notify-landlord-booking-request.js";
import { notifyTenantBookingAcceptedHttp } from "./notify-tenant-booking-accepted.js";
import { trustPublicIdentitiesForUserIds, trustPublicIdentityForUserId } from "./trust-display-resolve.js";
import { notifyUsersForNewListingSavedSearches } from "./saved-search-new-listing-notify.js";
import {
  applyBookingMineViewFilter,
  bookingMineOrderBy,
  bookingMineViewFromQuery,
} from "./booking-mine-view.js";

type AuthedRequest = Request & { userId?: string };

const SERVICE_NAME = "booking-service";

/** Peer-review list: landlord-approved (`pending_confirmation` / domain ACCEPTED), CONFIRMED, or COMPLETED. Excludes PENDING/created, rejected, cancelled, expired, and withdrawn-style terminal rows. */
const PEER_REVIEW_ELIGIBLE_RULE =
  "Bookings returned: database status `pending_confirmation` (domain APPROVED/ACCEPTED after landlord approval), `confirmed`, or `completed`. Excluded: `created` (pending request), `rejected`, `cancelled`, `expired`, and any withdrawn-style terminal state.";

const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
  await Promise.race([
    producer.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("kafka connect timeout")), connectMs),
    ),
  ]);
  producerReady = true;
  console.log("[booking] kafka producer connected (HTTP)");
}

async function publishBookingEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await ensureProducer();
    if (!producerReady) return;
    const message = {
      metadata: {
        event_id: randomUUID(),
        event_type: eventType,
        aggregate_id: aggregateId,
        aggregate_type: "booking",
        occurred_at: new Date().toISOString(),
        producer: SERVICE_NAME,
        version: "1",
      },
      payload,
    };
    await withKafkaProduceSpan(
      `kafka produce ${BOOKING_EVENTS_TOPIC}`,
      {
        "messaging.system": "kafka",
        "messaging.destination.name": BOOKING_EVENTS_TOPIC,
        "booking.event_type": eventType,
        "booking.aggregate_id": aggregateId,
      },
      async () => {
        await producer.send({
          topic: BOOKING_EVENTS_TOPIC,
          messages: [{ key: aggregateId, headers: buildKafkaMessageHeaders(), value: JSON.stringify(message) }],
        });
        console.info("[booking] kafka published", {
          topic: BOOKING_EVENTS_TOPIC,
          event_type: eventType,
          aggregate_id: aggregateId,
        });
      },
    );
  } catch (e) {
    console.warn("[booking] kafka publish skipped", e);
  }
}

async function emitBookingStatusUpdated(
  aggregateId: string,
  bookingRow: {
    id: string;
    listingId: string;
    landlordId: string;
    tenantId: string;
    listingTitleSnapshot?: string | null;
    tenantUsernameSnapshot?: string | null;
    tenantEmailSnapshot?: string | null;
  },
  previousPublic: string | null,
  newPublic: string,
  changedBy: "tenant" | "landlord" | "system",
): Promise<void> {
  await publishBookingEvent("booking.status.updated", aggregateId, {
    version: "v1",
    booking_id: bookingRow.id,
    listing_id: bookingRow.listingId,
    landlord_id: bookingRow.landlordId,
    tenant_id: bookingRow.tenantId,
    previous_status: previousPublic,
    new_status: newPublic,
    changed_by: changedBy,
    listing_title: bookingRow.listingTitleSnapshot ?? null,
    tenant_username_snapshot: bookingRow.tenantUsernameSnapshot ?? null,
    tenant_email: bookingRow.tenantEmailSnapshot ?? null,
  });
}

function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
  let userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  /** Match Prisma UUID strings (lowercase) so landlord/tenant checks cannot fail on case drift vs JWT `sub`. */
  if (UUID_RE.test(userId)) {
    userId = userId.toLowerCase();
  }
  req.userId = userId;
  next();
}

/** Path params may preserve uppercase UUID segments; DB rows are lowercase — normalize before Prisma lookups. */
function normalizeUuidPathParam(raw: string | undefined | null): string | null {
  const t = String(raw ?? "").trim();
  return UUID_RE.test(t) ? t.toLowerCase() : null;
}

const TENANT_NOTES_MAX = 4000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BookingDomainStatus =
  | "PENDING"
  | "ACCEPTED"
  | "CONFIRMED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "COMPLETED";

function dbToDomainStatus(status: string): BookingDomainStatus {
  switch (status) {
    case "created":
      return "PENDING";
    case "pending_confirmation":
      return "ACCEPTED";
    case "rejected":
      return "REJECTED";
    case "cancelled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    case "confirmed":
      return "CONFIRMED";
    case "completed":
      return "COMPLETED";
    default:
      return "PENDING";
  }
}

function domainToDbStatus(
  status: BookingDomainStatus,
): "created" | "pending_confirmation" | "rejected" | "cancelled" | "confirmed" | "expired" | "completed" {
  switch (status) {
    case "PENDING":
      return "created";
    case "ACCEPTED":
      return "pending_confirmation";
    case "CONFIRMED":
      return "confirmed";
    case "REJECTED":
      return "rejected";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    case "COMPLETED":
      return "completed";
  }
}

function canTransition(from: BookingDomainStatus, to: BookingDomainStatus): boolean {
  const allowed: Record<BookingDomainStatus, BookingDomainStatus[]> = {
    PENDING: ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"],
    ACCEPTED: ["CONFIRMED", "CANCELLED"],
    /** Renter may withdraw after confirming move-in until the stay is completed. */
    CONFIRMED: ["COMPLETED", "CANCELLED"],
    REJECTED: [],
    CANCELLED: [],
    EXPIRED: [],
    COMPLETED: [],
  };
  return allowed[from].includes(to);
}

function isTerminalStatus(status: BookingDomainStatus): boolean {
  return (
    status === "REJECTED" ||
    status === "CANCELLED" ||
    status === "EXPIRED" ||
    status === "COMPLETED"
  );
}

/** Redis listing occupancy counter: bump when landlord accepts; hold through CONFIRMED; clear when stay ends. */
function bookingCountsTowardRedisOccupancy(status: BookingDomainStatus): boolean {
  return status === "ACCEPTED" || status === "CONFIRMED";
}

function parseYmd(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function dateAtUtcMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function utcCalendarToday(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function hasStrictDateOverlap(
  existingStart: Date,
  existingEnd: Date,
  requestedStart: Date,
  requestedEnd: Date,
): boolean {
  return existingStart < requestedEnd && existingEnd > requestedStart;
}

function bookingExpiryDeadline(booking: { expiresAt: Date | null; createdAt: Date }): Date {
  return booking.expiresAt ?? new Date(new Date(booking.createdAt).getTime() + 48 * 60 * 60 * 1000);
}

/** Calendar-day span between lease start/end (UTC date fields). */
function bookingDurationDays(startDate: Date, endDate: Date): number {
  const s = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const e = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  return Math.round((e - s) / 86_400_000);
}

/** Stable API shape for dashboards and detail (includes duration + expiry). */
function bookingToPublicJson(booking: Booking) {
  const startDate = booking.startDate.toISOString().slice(0, 10);
  const endDate = booking.endDate.toISOString().slice(0, 10);
  const duration_days = bookingDurationDays(booking.startDate, booking.endDate);
  const expires_at = bookingExpiryDeadline(booking).toISOString();
  const unameSnap = String(booking.tenantUsernameSnapshot ?? "")
    .trim()
    .replace(/^@+/, "")
    .slice(0, 64);
  const emailHandle = renterHandleFromEmailSnapshot(booking.tenantEmailSnapshot);
  return {
    id: booking.id,
    booking_id: booking.id,
    listingId: booking.listingId,
    tenantId: booking.tenantId,
    landlordId: booking.landlordId,
    listing_id: booking.listingId,
    landlord_id: booking.landlordId,
    tenant_id: booking.tenantId,
    tenantNotes: booking.tenantNotes ?? null,
    status: dbToDomainStatus(String(booking.status)),
    startDate,
    endDate,
    duration_days,
    expires_at,
    listing_title: booking.listingTitleSnapshot ?? null,
    fraud_flagged: Boolean(booking.fraudFlagged),
    fraud_score: booking.fraudScore ?? 0,
    tenant_email: booking.tenantEmailSnapshot ?? null,
    renter_username: unameSnap || null,
    renter_display_name: null,
    renter_display: unameSnap || emailHandle || null,
    tenant_archived_at: booking.tenantArchivedAt ? booking.tenantArchivedAt.toISOString() : null,
  };
}

async function activeWatchCountForListing(listingId: string): Promise<number> {
  return prisma.watchlistItem.count({ where: { listingId, isActive: true } });
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isFraudAdminEmail(emailRaw: string): boolean {
  const csv = (process.env.BOOKING_FRAUD_ADMIN_EMAILS || "").trim();
  if (!csv || !emailRaw.trim()) return false;
  const set = new Set(csv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return set.has(emailRaw.trim().toLowerCase());
}

async function fetchCommunityReportsPendingCount(landlordId: string | undefined, admin: boolean): Promise<number> {
  const base = (process.env.LISTINGS_HTTP || "http://127.0.0.1:4012").replace(/\/$/, "");
  const secret = process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "";
  try {
    const url = admin ? `${base}/community/reports/pending-count?global=1` : `${base}/community/reports/pending-count`;
    const headers: Record<string, string> = {};
    if (!admin && landlordId) headers["x-user-id"] = landlordId;
    if (admin && secret) headers["x-booking-internal-secret"] = secret;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return 0;
    const j = (await r.json()) as { count?: number };
    return Number(j.count ?? 0);
  } catch {
    return 0;
  }
}

function parseFraudSignalsJson(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

function renterHandleFromEmailSnapshot(email: string | null | undefined): string {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return "";
  let local = (e.split("@")[0] ?? "").trim();
  local = local.replace(/\+.*/, "").trim();
  const h = local
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
    .slice(0, 48);
  return h;
}

async function tenantIdentityFromRequest(
  req: Request,
  userId: string | null | undefined,
  emailHdr: string | null,
): Promise<{ username: string | null; displayName: string | null; notifyLabel: string | null }> {
  const hdrUsername = (req.get("x-user-username") || "").trim().replace(/^@+/, "").slice(0, 64) || null;
  const uid = String(userId ?? "").trim().toLowerCase();
  const trustIdentity =
    uid && UUID_RE.test(uid) ? await trustPublicIdentityForUserId(uid) : null;
  const username = hdrUsername || trustIdentity?.username?.trim() || null;
  const displayName = trustIdentity?.display_name?.trim() || null;
  return {
    username,
    displayName,
    notifyLabel: username || displayName || renterHandleFromEmailSnapshot(emailHdr) || null,
  };
}

/** Prefer trust-service public username/display/email for tenant and landlord party ids. */
async function enrichBookingsPartyDisplayViaTrust<T extends Record<string, unknown>>(rows: T[]): Promise<T[]> {
  const tenantIds = [
    ...new Set(
      rows
        .map((r) => String(r.tenant_id ?? r.tenantId ?? "").trim().toLowerCase())
        .filter((id) => UUID_RE.test(id)),
    ),
  ];
  const landlordIds = [
    ...new Set(
      rows
        .map((r) => String(r.landlord_id ?? r.landlordId ?? "").trim().toLowerCase())
        .filter((id) => UUID_RE.test(id)),
    ),
  ];
  if (!tenantIds.length && !landlordIds.length) return rows;
  const [tenantIdentities, landlordIdentities] = await Promise.all([
    trustPublicIdentitiesForUserIds(tenantIds),
    trustPublicIdentitiesForUserIds(landlordIds),
  ]);
  if (tenantIdentities.size === 0 && landlordIdentities.size === 0) return rows;
  return rows.map((r) => {
    const tid = String(r.tenant_id ?? r.tenantId ?? "")
      .trim()
      .toLowerCase();
    const lid = String(r.landlord_id ?? r.landlordId ?? "")
      .trim()
      .toLowerCase();
    const tenantIdent = tenantIdentities.get(tid);
    const landlordIdent = landlordIdentities.get(lid);
    let next = r;
    if (tenantIdent) {
      const u = tenantIdent.username?.trim() || null;
      const d = tenantIdent.display_name?.trim() || null;
      next = {
        ...next,
        renter_username: u ?? (next as { renter_username?: string | null }).renter_username,
        renter_display_name: d ?? (next as { renter_display_name?: string | null }).renter_display_name,
        renter_display: u ? u : (next as { renter_display?: string | null }).renter_display,
      };
    }
    if (landlordIdent) {
      const email = landlordIdent.email?.trim() || null;
      next = {
        ...next,
        landlord_email: email ?? (next as { landlord_email?: string | null }).landlord_email,
        landlord_display:
          landlordIdent.display_name?.trim() ||
          (next as { landlord_display?: string | null }).landlord_display ||
          null,
      };
    }
    return next;
  });
}

type BookingMineRole = "tenant" | "landlord" | "either";

function bookingMineRoleFromQuery(req: Request): BookingMineRole {
  const raw = String(req.query?.role ?? "").trim().toLowerCase();
  if (raw === "landlord") return "landlord";
  if (raw === "either" || raw === "all") return "either";
  return "tenant";
}

function tenantBookingIdentityOr(
  userId: string,
  includeArchived: boolean,
  identityUsername?: string | null,
): Prisma.BookingWhereInput[] {
  const archive = !includeArchived ? { tenantArchivedAt: null } : {};
  const byId = { tenantId: userId, ...archive };
  const base = cleanUsernameIdentityBase(identityUsername);
  if (!base || base.length < 3) return [byId];
  return [
    byId,
    { tenantUsernameSnapshot: base, ...archive },
    { tenantUsernameSnapshot: { startsWith: `${base}_` }, ...archive },
  ];
}

function bookingMineWhere(
  userId: string,
  includeArchived: boolean,
  role: BookingMineRole,
  identityUsername?: string | null,
): Prisma.BookingWhereInput {
  if (role === "landlord") return { landlordId: userId };
  if (role === "either") {
    return {
      OR: [...tenantBookingIdentityOr(userId, includeArchived, identityUsername), { landlordId: userId }],
    };
  }
  const tenantOr = tenantBookingIdentityOr(userId, includeArchived, identityUsername);
  if (tenantOr.length === 1) return tenantOr[0]!;
  return { OR: tenantOr };
}

/** Prisma `where` for GET /bookings/mine?peer_review_eligible=1 (and /mine). */
function peerReviewEligibleWhere(
  userId: string,
  includeArchived: boolean,
  role: BookingMineRole,
  identityUsername?: string | null,
): Prisma.BookingWhereInput {
  const or: Prisma.BookingWhereInput[] = [];
  if (role === "tenant" || role === "either") {
    const tenantIdentity = tenantBookingIdentityOr(userId, includeArchived, identityUsername);
    for (const identity of tenantIdentity) {
      or.push({ ...identity, status: "completed" });
      or.push({ ...identity, status: "pending_confirmation" });
      or.push({ ...identity, status: "confirmed" });
    }
  }
  if (role === "landlord" || role === "either") {
    or.push(
      { landlordId: userId, status: "completed" },
      { landlordId: userId, status: "pending_confirmation" },
      { landlordId: userId, status: "confirmed" },
    );
  }
  return { OR: or };
}

async function handleListMineBookings(req: AuthedRequest, res: Response): Promise<void> {
  const includeArchived =
    String(
      req.query?.include_archived ??
        req.query?.includeArchived ??
        req.query?.include_hidden ??
        req.query?.includeHidden ??
        "",
    ).trim() === "1";
  const peerReviewEligible =
    String(req.query?.peer_review_eligible ?? req.query?.peerReviewEligible ?? "").trim() === "1";
  const role = bookingMineRoleFromQuery(req);
  const view = peerReviewEligible ? ("all" as const) : bookingMineViewFromQuery(req.query?.view);
  const limitRaw = Number(req.query?.limit);
  const take =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 100;
  const identityUsername = (req.get("x-user-username") || "").trim() || null;

  let where: Prisma.BookingWhereInput = peerReviewEligible
    ? peerReviewEligibleWhere(req.userId!, includeArchived, role, identityUsername)
    : bookingMineWhere(req.userId!, includeArchived, role, identityUsername);
  if (!peerReviewEligible) {
    where = applyBookingMineViewFilter(where, view);
  }

  const rows = await prisma.booking.findMany({
    where,
    orderBy: peerReviewEligible ? { createdAt: "desc" } : bookingMineOrderBy(view),
    take,
  });
  const bookings = await Promise.all(
    rows.map(async (b) => {
      const base = bookingToPublicJson(b);
      const listing = await resolveListingCard(b.listingId, {
        title: b.listingTitleSnapshot,
        priceCentsSnapshot: b.priceCentsSnapshot,
      });
      return {
        ...base,
        listing,
        landlord_display: listing.landlord_display ?? null,
      };
    }),
  );
  let enriched = await enrichBookingsPartyDisplayViaTrust(bookings as Record<string, unknown>[]);
  if (role === "tenant") {
    enriched = enriched.filter((row) => !isIntegrationBookingRow(row));
  }
  res.json({
    ...(peerReviewEligible ? { peer_review_eligible_rule: PEER_REVIEW_ELIGIBLE_RULE } : {}),
    role,
    include_archived: includeArchived,
    view,
    limit: take,
    bookings: enriched,
  });
}

export function createBookingHttpApp(): Express {
  const app = express();
  initOchOutboxSurfaceUnsupported();
  app.use(tracingMiddleware);
  mountDebugTraceHeaders(app);
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "booking",
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
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ ok: true, db: "connected" });
    } catch {
      res.status(200).json({ ok: true, db: "disconnected", warning: "database unavailable" });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  const bookingListingsSecret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  function requireBookingListingsSecret(req: Request, res: Response, next: NextFunction): void {
    const h = (req.get("x-booking-internal-secret") || "").trim();
    if (!bookingListingsSecret || h !== bookingListingsSecret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  }

  /**
   * Listings marketplace: hide search rows when an active booking overlaps the occupancy window
   * (created / pending_confirmation / confirmed — aligned with overlap checks on create + availability).
   * Body: { listing_ids, overlap_start_date?, overlap_end_date? } — YYYY-MM-DD calendar days in UTC, aligned with
   * `booking.bookings.start_date` / `end_date` (@db.Date). Omitted overlap defaults to UTC "today" on this service.
   * Listings-service normally sends explicit overlap_start/end on every call so comparisons stay date-only.
   */
  app.post(
    "/internal/reserved-search-listing-ids",
    requireBookingListingsSecret,
    async (req: Request, res: Response) => {
      try {
        const body = req.body as {
          listing_ids?: unknown;
          overlap_start_date?: unknown;
          overlap_end_date?: unknown;
        };
        const raw = body.listing_ids;
        const ids = Array.isArray(raw) ? raw.map((x) => String(x)).filter((id) => UUID_RE.test(id)) : [];
        if (ids.length > 500) {
          res.status(400).json({ error: "too_many_ids" });
          return;
        }
        if (ids.length === 0) {
          res.json({ reserved_listing_ids: [] });
          return;
        }
        const s = parseYmd(body.overlap_start_date);
        const e = parseYmd(body.overlap_end_date);
        let rangeStart: Date;
        let rangeEnd: Date;
        if (s && e) {
          const a = s <= e ? s : e;
          const b = s <= e ? e : s;
          rangeStart = dateAtUtcMidnight(a);
          rangeEnd = dateAtUtcMidnight(b);
        } else if (s) {
          rangeStart = rangeEnd = dateAtUtcMidnight(s);
        } else {
          const t = utcCalendarToday();
          rangeStart = t;
          rangeEnd = t;
        }
        if (rangeStart.getTime() === rangeEnd.getTime()) {
          rangeEnd = new Date(rangeEnd.getTime() + 86_400_000);
        }
        const reservedRows = await prisma.booking.findMany({
          where: {
            listingId: { in: ids },
            /** Match marketplace + create overlap: active tenant holds (created) and accepted stays. */
            status: { in: ["created", "pending_confirmation", "confirmed"] },
            startDate: { lt: rangeEnd },
            endDate: { gt: rangeStart },
          },
          distinct: ["listingId"],
          select: { listingId: true },
        });
        res.json({ reserved_listing_ids: reservedRows.map((r) => r.listingId) });
      } catch (error) {
        console.error("[booking] internal reserved-search-listing-ids failed", error);
        res.status(500).json({ error: "internal" });
      }
    },
  );

  app.post(
    "/internal/new-listing-saved-search-notify",
    requireBookingListingsSecret,
    async (req: Request, res: Response) => {
      try {
        const body = req.body as Record<string, unknown>;
        const listing_id = String(body.listing_id || "").trim();
        const landlord_user_id = String(body.landlord_user_id || body.user_id || "").trim();
        if (!UUID_RE.test(listing_id) || !UUID_RE.test(landlord_user_id)) {
          res.status(400).json({ error: "listing_id and landlord_user_id must be UUIDs" });
          return;
        }
        const out = await notifyUsersForNewListingSavedSearches(prisma, {
          listing_id,
          landlord_user_id,
          title: String(body.title || ""),
          price_cents: Number(body.price_cents ?? 0),
          residence_type: body.residence_type != null ? String(body.residence_type) : null,
          size_sqft: body.size_sqft != null ? Number(body.size_sqft) : null,
          bedrooms: body.bedrooms != null ? Number(body.bedrooms) : null,
          bathrooms: body.bathrooms != null ? Number(body.bathrooms) : null,
          latitude: body.latitude != null ? Number(body.latitude) : null,
          longitude: body.longitude != null ? Number(body.longitude) : null,
          status: body.status != null ? String(body.status) : null,
        });
        res.json({ ok: true, notified: out.notified });
      } catch (error) {
        console.error("[booking] internal new-listing-saved-search-notify failed", error);
        res.status(500).json({ error: "internal" });
      }
    },
  );

  app.use(
    createHttpConcurrencyGuard({
      envVar: "BOOKING_HTTP_MAX_CONCURRENT",
      defaultMax: 75,
      serviceLabel: "booking-service",
    }),
  );

  app.post("/create", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { listingId, startDate, endDate, landlordId, priceCents } = req.body as {
        listingId?: string;
        startDate?: string;
        endDate?: string;
        landlordId?: string;
        priceCents?: number;
      };
      if (!listingId || !startDate || !endDate || !req.userId) {
        res.status(400).json({ error: "listingId, startDate, endDate required" });
        return;
      }

      const start = dateAtUtcMidnight(startDate);
      const end = dateAtUtcMidnight(endDate);
      if (!(start < end)) {
        res.status(400).json({ error: "invalid date range: endDate must be after startDate" });
        return;
      }

      const requestTraceCtx = getIncomingHttpOtelContext(req);
      let listingMeta: { landlordId: string; priceCents: number; title: string | null } | null = null;
      try {
        listingMeta = await fetchListingForBookingRequest(listingId, requestTraceCtx);
      } catch {
        res.status(502).json({ error: "listing fetch failed" });
        return;
      }
      const bodyLandlord =
        landlordId && UUID_RE.test(String(landlordId).trim()) ? String(landlordId).trim().toLowerCase() : "";
      if (listingMeta) {
        if (listingMeta.landlordId === req.userId) {
          res.status(400).json({ error: "cannot book your own listing" });
          return;
        }
      } else if (!bodyLandlord || bodyLandlord === req.userId) {
        /** Integration / offline tests without listings-service: require an explicit other-party landlord id. */
        res.status(404).json({ error: "listing not found" });
        return;
      }
      const resolvedLandlord = listingMeta?.landlordId ?? bodyLandlord;
      const resolvedPriceCents = listingMeta
        ? listingMeta.priceCents
        : Number.isFinite(Number(priceCents))
          ? Number(priceCents)
          : 0;
      const listingTitleSnapshot = listingMeta?.title ?? null;

      const overlap = await prisma.booking.findFirst({
        where: {
          listingId,
          status: { in: ["created", "pending_confirmation", "confirmed"] },
          startDate: { lt: end },
          endDate: { gt: start },
        },
        select: { id: true },
      });
      if (overlap) {
        res.status(409).json({ error: "listing unavailable for selected dates" });
        return;
      }
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const tenantEmailHdr = (req.get("x-user-email") || "").trim() || null;
      const tenantIdentity = await tenantIdentityFromRequest(req, req.userId, tenantEmailHdr);
      const tenantUsernameHdr = tenantIdentity.username;
      const booking = await prisma.booking.create({
        data: {
          listingId,
          tenantId: req.userId,
          landlordId: resolvedLandlord,
          status: "created" as const,
          startDate: start,
          endDate: end,
          priceCentsSnapshot: resolvedPriceCents,
          currencyCode: "USD",
          expiresAt,
          statusUpdatedAt: new Date(),
          listingTitleSnapshot,
          tenantEmailSnapshot: tenantEmailHdr ? tenantEmailHdr.slice(0, 320) : null,
          tenantUsernameSnapshot: tenantUsernameHdr,
        },
      });

      await publishBookingEvent("BookingCreatedV1", booking.id, {
        booking_id: booking.id,
        listing_id: booking.listingId,
        tenant_id: booking.tenantId,
        renter_id: booking.tenantId,
        landlord_id: booking.landlordId,
        listing_title: listingTitleSnapshot,
        tenant_username: tenantIdentity.username,
        tenant_username_snapshot: tenantIdentity.username,
        tenant_display_name: tenantIdentity.displayName,
        tenant_email: tenantEmailHdr,
        booking_status: "PENDING",
        start_date: booking.startDate.toISOString().slice(0, 10),
        end_date: booking.endDate.toISOString().slice(0, 10),
        deep_link: `/dashboard/bookings/${encodeURIComponent(booking.id)}`,
      });

      await emitBookingStatusUpdated(
        booking.id,
        {
          id: booking.id,
          listingId: booking.listingId,
          landlordId: booking.landlordId,
          tenantId: booking.tenantId,
          listingTitleSnapshot: booking.listingTitleSnapshot ?? null,
        },
        null,
        "PENDING",
        "tenant",
      );
      recordBookingEnteredDomainStatus("PENDING");

      await publishBookingEvent("booking.thread.ensure", booking.id, {
        booking_id: booking.id,
        listing_id: booking.listingId,
        landlord_id: booking.landlordId,
        tenant_id: booking.tenantId,
      });

      await notifyLandlordBookingRequestHttp({
        landlordId: booking.landlordId,
        bookingId: booking.id,
        listingId: booking.listingId,
        tenantId: booking.tenantId,
        createdAt: booking.createdAt.toISOString(),
        listingTitle: listingTitleSnapshot,
        tenantUsername: tenantIdentity.username,
        tenantUsernameSnapshot: tenantIdentity.username,
        tenantDisplayName: tenantIdentity.displayName,
        tenantEmail: tenantEmailHdr,
        bookingStatus: "PENDING",
        startDate: booking.startDate.toISOString().slice(0, 10),
        endDate: booking.endDate.toISOString().slice(0, 10),
      }, requestTraceCtx);

      res.status(201).json(bookingToPublicJson(booking));
    } catch (error) {
      console.error("[booking] create failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/listings/:listingId/availability", async (req: Request, res: Response) => {
    try {
      const listingId = String(req.params.listingId || "").trim();
      if (!UUID_RE.test(listingId)) {
        res.status(400).json({ error: "invalid listingId" });
        return;
      }
      const rawStart = parseYmd(req.query.startDate);
      const rawEnd = parseYmd(req.query.endDate);
      let rangeStart = rawStart ? dateAtUtcMidnight(rawStart) : utcCalendarToday();
      let rangeEnd = rawEnd ? dateAtUtcMidnight(rawEnd) : rangeStart;
      if (rangeStart > rangeEnd) {
        const tmp = rangeStart;
        rangeStart = rangeEnd;
        rangeEnd = tmp;
      }
      // Convert single-day probes into [day, day+1) for strict-overlap comparisons.
      if (rangeStart.getTime() === rangeEnd.getTime()) {
        rangeEnd = new Date(rangeEnd.getTime() + 86_400_000);
      }
      const rows = await prisma.booking.findMany({
        where: {
          listingId,
          status: { in: ["created", "pending_confirmation", "confirmed"] },
          startDate: { lt: rangeEnd },
          endDate: { gt: rangeStart },
        },
        orderBy: { startDate: "asc" },
        select: { startDate: true, endDate: true, status: true },
      });
      const conflicts = rows.filter((row) => hasStrictDateOverlap(row.startDate, row.endDate, rangeStart, rangeEnd));
      res.json({
        available: conflicts.length === 0,
        conflicts: conflicts.length,
        ranges: conflicts.map((r) => ({
          startDate: r.startDate.toISOString().slice(0, 10),
          endDate: r.endDate.toISOString().slice(0, 10),
          status: String(r.status),
        })),
      });
    } catch (error) {
      console.error("[booking] availability check failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/confirm", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { bookingId } = req.body as { bookingId?: string };
      if (!bookingId) {
        res.status(400).json({ error: "bookingId required" });
        return;
      }

      const current = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      const from = dbToDomainStatus(String(current.status));
      if (from !== "ACCEPTED") {
        res.status(409).json({ error: `cannot confirm from status ${from}` });
        return;
      }
      if (current.tenantId !== req.userId) {
        res.status(403).json({ error: "only tenant can confirm payment/agreement" });
        return;
      }
      const next: BookingDomainStatus = "CONFIRMED";
      if (!canTransition(from, next)) {
        res.status(409).json({ error: `invalid transition ${from} -> ${next}` });
        return;
      }

      const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: domainToDbStatus(next),
          confirmedAt: new Date(),
          statusUpdatedAt: new Date(),
        },
      });

      await emitBookingStatusUpdated(
        updated.id,
        {
          id: updated.id,
          listingId: updated.listingId,
          landlordId: updated.landlordId,
          tenantId: updated.tenantId,
          listingTitleSnapshot: updated.listingTitleSnapshot ?? null,
        },
        from,
        next,
        "tenant",
      );
      recordBookingEnteredDomainStatus(next);
      /* Intentionally no Redis occupancy decrement: counter stays elevated until COMPLETED / CANCELLED / etc. */

      await publishBookingEvent("BookingConfirmedV1", updated.id, {
        booking_id: updated.id,
        listing_id: updated.listingId,
        tenant_id: updated.tenantId,
        landlord_id: updated.landlordId || "",
      });

      await releaseListingSoftLock(updated.listingId);

      res.json(updated);
    } catch (error) {
      console.error("[booking] confirm failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/cancel", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { bookingId, cancelledBy } = req.body as { bookingId?: string; cancelledBy?: string };
      if (!bookingId) {
        res.status(400).json({ error: "bookingId required" });
        return;
      }
      const actor = cancelledBy || "tenant";
      const current = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (current.tenantId !== req.userId) {
        res.status(403).json({ error: "only tenant can cancel (spec)" });
        return;
      }
      if (current.status === "cancelled") {
        res.status(409).json({ error: "booking already cancelled" });
        return;
      }

      const from = dbToDomainStatus(String(current.status));
      const next: BookingDomainStatus = "CANCELLED";
      if (!canTransition(from, next)) {
        res.status(409).json({ error: `invalid transition ${from} -> ${next}` });
        return;
      }

      const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: domainToDbStatus(next),
          cancellationReason: `cancelled_by:${actor}`,
          cancelledAt: new Date(),
          statusUpdatedAt: new Date(),
        },
      });

      await emitBookingStatusUpdated(
        updated.id,
        {
          id: updated.id,
          listingId: updated.listingId,
          landlordId: updated.landlordId,
          tenantId: updated.tenantId,
          listingTitleSnapshot: updated.listingTitleSnapshot ?? null,
          tenantUsernameSnapshot: updated.tenantUsernameSnapshot ?? null,
          tenantEmailSnapshot: updated.tenantEmailSnapshot ?? null,
        },
        from,
        next,
        "tenant",
      );
      recordBookingEnteredDomainStatus(next);

      await publishBookingEvent("BookingCancelledV1", updated.id, {
        booking_id: updated.id,
        listing_id: updated.listingId,
        cancelled_by: actor,
      });

      await releaseListingSoftLock(updated.listingId);
      /** Occupancy counter: only decrement when leaving ACCEPTED or CONFIRMED (never on PENDING-only or confirm). */
      if (bookingCountsTowardRedisOccupancy(from)) {
        await decrementListingBookingCount(updated.listingId);
      }

      res.json(updated);
    } catch (error) {
      console.error("[booking] cancel failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/search-history", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const {
        query,
        minPriceCents,
        maxPriceCents,
        maxDistanceKm,
        maxCampusMiles,
        latitude,
        longitude,
        filters,
        alertOnMatch,
      } = req.body as {
        query?: string;
        minPriceCents?: number;
        maxPriceCents?: number;
        maxDistanceKm?: number;
        /** Max distance from campus in miles (saved search + alerts). */
        maxCampusMiles?: number;
        latitude?: number;
        longitude?: number;
        filters?: Record<string, unknown>;
        alertOnMatch?: boolean;
      };
      let miles: number | null =
        maxCampusMiles != null && Number.isFinite(Number(maxCampusMiles)) && Number(maxCampusMiles) > 0
          ? Math.min(50, Number(maxCampusMiles))
          : null;
      if (miles == null && maxDistanceKm != null && Number.isFinite(Number(maxDistanceKm)) && Number(maxDistanceKm) > 0) {
        miles = Math.min(50, Number(maxDistanceKm) * 0.621371);
      }
      const row = await prisma.searchHistory.create({
        data: {
          userId: req.userId!,
          query: query || null,
          minPriceCents: minPriceCents ?? null,
          maxPriceCents: maxPriceCents ?? null,
          maxDistanceKm: maxDistanceKm ?? null,
          maxCampusMiles: miles,
          alertOnMatch: Boolean(alertOnMatch),
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          filters: (filters as Prisma.InputJsonValue | undefined) ?? undefined,
        },
      });
      res.status(201).json(row);
    } catch (error) {
      console.error("[booking] search-history create failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/search-history/list", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit || 25), 100);
      const items = await prisma.searchHistory.findMany({
        where: { userId: req.userId! },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      res.json({ items });
    } catch (error) {
      console.error("[booking] search-history list failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  /** Public aggregate watch counts for marketplace cards / search enrichment (no PII). */
  app.get("/watchlist/listing-counts", async (req: Request, res: Response) => {
    try {
      const raw = String(req.query.ids ?? "").trim();
      const ids = [
        ...new Set(
          raw
            .split(/[,]+/)
            .map((s) => s.trim())
            .filter((id) => UUID_RE.test(id)),
        ),
      ].slice(0, 120);
      const counts: Record<string, number> = {};
      for (const id of ids) counts[id] = 0;
      if (ids.length === 0) {
        res.json({ counts });
        return;
      }
      const grouped = await prisma.watchlistItem.groupBy({
        by: ["listingId"],
        where: { listingId: { in: ids }, isActive: true },
        _count: { _all: true },
      });
      for (const row of grouped) {
        counts[row.listingId] = row._count._all;
      }
      res.json({ counts });
    } catch (error) {
      console.error("[booking] watchlist listing-counts failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/watchlist/listings/:listingId/count", async (req: Request, res: Response) => {
    try {
      const listingId = String(req.params.listingId || "").trim();
      if (!UUID_RE.test(listingId)) {
        res.status(400).json({ error: "invalid listing id" });
        return;
      }
      const n = await prisma.watchlistItem.count({
        where: { listingId, isActive: true },
      });
      res.json({ listing_id: listingId, watch_count: n });
    } catch (error) {
      console.error("[booking] watchlist listing count failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/watchlist/add", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { listingId, source } = req.body as { listingId?: string; source?: string };
      if (!listingId) {
        res.status(400).json({ error: "listingId required" });
        return;
      }
      const item = await prisma.watchlistItem.upsert({
        where: {
          userId_listingId: {
            userId: req.userId!,
            listingId,
          },
        },
        update: {
          isActive: true,
          removedAt: null,
          source: source ?? null,
        },
        create: {
          userId: req.userId!,
          listingId,
          source: source ?? null,
          isActive: true,
        },
      });
      const watch_count = await activeWatchCountForListing(listingId);
      res.status(201).json({ ...item, listing_id: listingId, watch_count });
    } catch (error) {
      console.error("[booking] watchlist add failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/watchlist/remove", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { listingId } = req.body as { listingId?: string };
      if (!listingId) {
        res.status(400).json({ error: "listingId required" });
        return;
      }
      const updated = await prisma.watchlistItem.updateMany({
        where: { userId: req.userId!, listingId, isActive: true },
        data: { isActive: false, removedAt: new Date() },
      });
      const watch_count = await activeWatchCountForListing(listingId);
      res.json({
        ok: true,
        removed: updated.count,
        message: "Removed from watchlist",
        listing_id: listingId,
        watch_count,
      });
    } catch (error) {
      console.error("[booking] watchlist remove failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/watchlist/list", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const items = await prisma.watchlistItem.findMany({
        where: { userId: req.userId!, isActive: true },
        orderBy: { addedAt: "desc" },
      });
      res.json({ items });
    } catch (error) {
      console.error("[booking] watchlist list failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  async function fetchListingForBookingRequest(
    listingId: string,
    propagationContext?: ReturnType<typeof getIncomingHttpOtelContext>,
  ): Promise<{
    landlordId: string;
    priceCents: number;
    title: string | null;
    listing_on_hold: boolean;
    pricing_mode: "fixed" | "obo";
  } | null> {
    return fetchListingMetaForBookingRequest(listingId, propagationContext ?? undefined);
  }

  /** Tour/booking interest: validates listing via listings-service HTTP, creates booking row, emits Kafka. */
  app.post("/request", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { listing_id, renter_id, requested_date, message } = req.body as {
        listing_id?: string;
        renter_id?: string;
        requested_date?: string;
        message?: string;
      };
      if (!listing_id || !renter_id || !requested_date) {
        res.status(400).json({ error: "listing_id, renter_id, requested_date required" });
        return;
      }
      if (!UUID_RE.test(listing_id)) {
        res.status(400).json({ error: "invalid listing_id" });
        return;
      }
      if (renter_id !== req.userId) {
        res.status(403).json({ error: "renter_id must match authenticated user" });
        return;
      }
      if (await isTenantBookingBanned(renter_id)) {
        res.status(403).json({ error: "tenant_booking_banned" });
        return;
      }
      const day = String(requested_date).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        res.status(400).json({ error: "requested_date must be YYYY-MM-DD" });
        return;
      }

      let meta: {
        landlordId: string;
        priceCents: number;
        title: string | null;
        listing_on_hold: boolean;
        pricing_mode: "fixed" | "obo";
      } | null;
      try {
        meta = await fetchListingForBookingRequest(listing_id, getIncomingHttpOtelContext(req));
      } catch {
        res.status(502).json({ error: "listing fetch failed" });
        return;
      }
      if (!meta) {
        res.status(404).json({ error: "listing not found" });
        return;
      }
      if (meta.listing_on_hold) {
        res.status(409).json({ error: "listing_on_hold", message: "This listing is temporarily on hold for new requests." });
        return;
      }

      const startDate = new Date(`${day}T00:00:00.000Z`);
      const endDate = new Date(`${day}T00:00:00.000Z`);
      const note =
        message != null && String(message).trim() !== ""
          ? String(message).slice(0, TENANT_NOTES_MAX)
          : null;

      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const booking = await prisma.booking.create({
        data: {
          listingId: listing_id,
          tenantId: renter_id,
          landlordId: meta.landlordId,
          status: "created" as const,
          startDate,
          endDate,
          priceCentsSnapshot: meta.priceCents,
          currencyCode: "USD",
          tenantNotes: note,
          expiresAt,
          statusUpdatedAt: new Date(),
        },
      });
      const lockAcquired = await acquireListingSoftLock(booking.listingId, booking.tenantId, 300);
      if (!lockAcquired) {
        await prisma.booking.delete({ where: { id: booking.id } }).catch(() => {});
        res.status(409).json({ error: "listing temporarily unavailable" });
        return;
      }
      const now = new Date();
      const recent10m = await prisma.booking.count({
        where: { tenantId: booking.tenantId, createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) } },
      });
      const recent5m = await prisma.booking.count({
        where: { tenantId: booking.tenantId, createdAt: { gte: new Date(now.getTime() - 5 * 60 * 1000) } },
      });
      const tenantEmailHdr = (req.get("x-user-email") || "").trim() || null;
      const tenantIdentity = await tenantIdentityFromRequest(req, renter_id, tenantEmailHdr);
      const tenantUsernameHdr = tenantIdentity.username;
      const renterAccountAgeHoursRaw = Number(req.get("x-renter-account-age-hours") || "");
      const renterAccountAgeHours = Number.isFinite(renterAccountAgeHoursRaw)
        ? renterAccountAgeHoursRaw
        : 8760;
      const fraud = await computeFraudScore({
        bookingId: booking.id,
        listingId: booking.listingId,
        renterId: booking.tenantId,
        priceCents: meta.priceCents,
        requestIp: req.ip || "",
        recentBookingCount10m: recent10m,
        recentBookingCount5m: recent5m,
        renterAccountAgeHours,
      });

      const signalsJson = fraudFactorsToSignals(fraud.factors);
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          fraudScore: fraud.score,
          fraudFlagged: fraud.flagged,
          fraudSignals: signalsJson as unknown as Prisma.InputJsonValue,
          listingTitleSnapshot: meta.title,
          tenantEmailSnapshot: tenantEmailHdr ? tenantEmailHdr.slice(0, 320) : null,
          tenantUsernameSnapshot: tenantUsernameHdr,
        },
      });

      bookingRequestsTotal.inc();
      recordBookingEnteredDomainStatus("PENDING");
      if (fraud.flagged) bookingFraudFlaggedTotal.inc();

      await publishBookingEvent("BookingRequestV1", booking.id, {
        booking_id: booking.id,
        listing_id: booking.listingId,
        tenant_id: booking.tenantId,
        renter_id: booking.tenantId,
        landlord_id: booking.landlordId,
        listing_title: meta.title,
        tenant_username: tenantIdentity.username,
        tenant_username_snapshot: tenantIdentity.username,
        tenant_display_name: tenantIdentity.displayName,
        tenant_email: tenantEmailHdr,
        booking_status: "PENDING",
        start_date: booking.startDate.toISOString().slice(0, 10),
        end_date: booking.endDate.toISOString().slice(0, 10),
        deep_link: `/dashboard/bookings/${encodeURIComponent(booking.id)}`,
        requested_date: day,
        message_present: Boolean(note),
        fraud_score: fraud.score,
        fraud_flagged: fraud.flagged,
        fraud_factors: fraud.factors,
      });
      await notifyLandlordBookingRequestHttp({
        landlordId: booking.landlordId,
        bookingId: booking.id,
        listingId: booking.listingId,
        tenantId: booking.tenantId,
        createdAt: booking.createdAt.toISOString(),
        listingTitle: meta.title,
        tenantUsername: tenantIdentity.username,
        tenantUsernameSnapshot: tenantIdentity.username,
        tenantDisplayName: tenantIdentity.displayName,
        tenantEmail: tenantEmailHdr,
        bookingStatus: "PENDING",
        startDate: booking.startDate.toISOString().slice(0, 10),
        endDate: booking.endDate.toISOString().slice(0, 10),
      }, getIncomingHttpOtelContext(req));
      if (fraud.flagged) {
        await publishBookingEvent("booking.fraud_flagged", booking.id, {
          bookingId: booking.id,
          listingId: booking.listingId,
          renterId: booking.tenantId,
          landlordId: booking.landlordId,
          fraud_score: fraud.score,
          fraud_factors: fraud.factors,
        });
      }

      await emitBookingStatusUpdated(
        booking.id,
        {
          id: booking.id,
          listingId: booking.listingId,
          landlordId: booking.landlordId,
          tenantId: booking.tenantId,
          listingTitleSnapshot: booking.listingTitleSnapshot ?? null,
        },
        null,
        "PENDING",
        "tenant",
      );

      await publishBookingEvent("booking.thread.ensure", booking.id, {
        booking_id: booking.id,
        listing_id: booking.listingId,
        landlord_id: booking.landlordId,
        tenant_id: booking.tenantId,
      });

      const saved = await prisma.booking.findUnique({ where: { id: booking.id } });
      if (!saved) {
        res.status(500).json({ error: "internal" });
        return;
      }

      res.status(201).json({
        ok: true,
        ...bookingToPublicJson(saved),
        requested_date: day,
      });
    } catch (error) {
      console.error("[booking] request failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/fraud-cases", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const email = (req.get("x-user-email") || "").trim();
      const admin = isFraudAdminEmail(email);
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(240, Math.max(1, Number(req.query.pageSize ?? 24)));
      const minScore = Math.min(100, Math.max(0, Number(req.query.minScore ?? 60)));

      const where: Prisma.BookingWhereInput = {
        ...(admin ? {} : { landlordId: req.userId! }),
        fraudReviewStatus: null,
        OR: [{ fraudScore: { gte: minScore } }, { fraudFlagged: true }],
      };

      const [totalCount, rows] = await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const cases = await Promise.all(
        rows.map(async (b) => {
          const listing = await resolveListingCard(b.listingId, {
            title: b.listingTitleSnapshot,
            priceCentsSnapshot: b.priceCentsSnapshot,
          });
          const snap = String(b.tenantEmailSnapshot ?? "").trim();
          const tenant_display = snap.includes("@")
            ? snap.split("@")[0]!.slice(0, 64)
            : snap
              ? snap.slice(0, 64)
              : "";
          return {
            booking_id: b.id,
            listing_id: b.listingId,
            tenant_id: b.tenantId,
            landlord_id: b.landlordId,
            fraud_score: b.fraudScore ?? 0,
            fraud_flagged: b.fraudFlagged,
            signals: parseFraudSignalsJson(b.fraudSignals),
            tenant_email: snap,
            tenant_display,
            listing_title: listing.title,
            listing,
            created_at: b.createdAt.toISOString(),
          };
        }),
      );

      const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
      res.json({ cases, totalCount, page, totalPages });
    } catch (error) {
      console.error("[booking] fraud-cases list failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/fraud-cases/:bookingId/action", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bookingId = normalizeUuidPathParam(req.params.bookingId);
      if (!bookingId) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const action = String((req.body as { action?: string })?.action || "")
        .trim()
        .toLowerCase();
      if (!["reviewed", "ignore", "ban"].includes(action)) {
        res.status(400).json({ error: "invalid action" });
        return;
      }
      const email = (req.get("x-user-email") || "").trim();
      const admin = isFraudAdminEmail(email);

      const row = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!row) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (!admin && row.landlordId !== req.userId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }

      if (action === "ban") {
        await persistTenantBookingBan(row.tenantId);
        await publishTrustEvent("tenant.banned", row.tenantId, {
          tenant_id: row.tenantId,
          reason: "fraud_score_high",
        });
        await prisma.booking.update({
          where: { id: bookingId },
          data: { fraudReviewStatus: "reviewed" },
        });
        res.json({ ok: true, action: "ban" });
        return;
      }

      const statusLabel = action === "ignore" ? "ignored" : "reviewed";
      await prisma.booking.update({
        where: { id: bookingId },
        data: { fraudReviewStatus: statusLabel },
      });
      res.json({ ok: true, action: statusLabel });
    } catch (error) {
      console.error("[booking] fraud action failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/dashboard/moderation", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const landlordId = req.userId!;
      const email = (req.get("x-user-email") || "").trim();
      const admin = isFraudAdminEmail(email);
      const [pendingBookings, fraudFlags, communityReports, pendingRows] = await Promise.all([
        prisma.booking.count({ where: { landlordId, status: "created" } }),
        prisma.booking.count({
          where: { landlordId, fraudFlagged: true, fraudReviewStatus: null },
        }),
        fetchCommunityReportsPendingCount(admin ? undefined : landlordId, admin),
        prisma.booking.findMany({
          where: { landlordId, status: "created" },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            listingId: true,
            tenantId: true,
            fraudScore: true,
            fraudFlagged: true,
            fraudSignals: true,
            listingTitleSnapshot: true,
            priceCentsSnapshot: true,
            tenantEmailSnapshot: true,
            createdAt: true,
            startDate: true,
            endDate: true,
            expiresAt: true,
            status: true,
          },
        }),
      ]);
      const pendingBookingRows = await Promise.all(
        pendingRows.map(async (b) => {
          try {
            const listing = await resolveListingCard(b.listingId, {
              title: b.listingTitleSnapshot,
              priceCentsSnapshot: b.priceCentsSnapshot,
            });
            return {
              booking_id: b.id,
              listing_id: b.listingId,
              tenant_id: b.tenantId,
              fraud_score: b.fraudScore ?? 0,
              fraud_flagged: b.fraudFlagged,
              signals: parseFraudSignalsJson(b.fraudSignals),
              listing_title: listing.title,
              listing,
              tenant_email: b.tenantEmailSnapshot ?? "",
              renter_handle: renterHandleFromEmailSnapshot(b.tenantEmailSnapshot),
              created_at: b.createdAt.toISOString(),
              startDate: b.startDate.toISOString().slice(0, 10),
              endDate: b.endDate.toISOString().slice(0, 10),
              duration_days: bookingDurationDays(b.startDate, b.endDate),
              expires_at: bookingExpiryDeadline(b).toISOString(),
              status: dbToDomainStatus(String(b.status)),
            };
          } catch (rowErr) {
            console.error("[booking] moderation row enrich failed", rowErr);
            return {
              booking_id: b.id,
              listing_id: b.listingId,
              tenant_id: b.tenantId,
              fraud_score: b.fraudScore ?? 0,
              fraud_flagged: b.fraudFlagged,
              signals: parseFraudSignalsJson(b.fraudSignals),
              listing_title: String(b.listingTitleSnapshot ?? "").trim() || "Listing",
              listing: listingCardFromBookingSnapshot({
                listingId: b.listingId,
                title: b.listingTitleSnapshot,
                priceCentsSnapshot: b.priceCentsSnapshot,
              }),
              tenant_email: b.tenantEmailSnapshot ?? "",
              renter_handle: renterHandleFromEmailSnapshot(b.tenantEmailSnapshot),
              created_at: b.createdAt.toISOString(),
              startDate: b.startDate.toISOString().slice(0, 10),
              endDate: b.endDate.toISOString().slice(0, 10),
              duration_days: bookingDurationDays(b.startDate, b.endDate),
              expires_at: bookingExpiryDeadline(b).toISOString(),
              status: dbToDomainStatus(String(b.status)),
            };
          }
        }),
      );
      res.json({ pendingBookings, fraudFlags, communityReports, pendingBookingRows });
    } catch (error) {
      console.error("[booking] dashboard moderation failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.patch("/:bookingId", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = normalizeUuidPathParam(req.params.bookingId);
      if (!bid) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const { tenantNotes } = req.body as { tenantNotes?: string | null };
      if (!Object.prototype.hasOwnProperty.call(req.body, "tenantNotes")) {
        res.status(400).json({ error: "tenantNotes required (string or null)" });
        return;
      }
      if (tenantNotes !== null && typeof tenantNotes !== "string") {
        res.status(400).json({ error: "tenantNotes must be string or null" });
        return;
      }

      const current = await prisma.booking.findUnique({ where: { id: bid } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (current.tenantId !== req.userId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const terminalDb = new Set(["cancelled", "completed", "rejected", "expired"]);
      if (terminalDb.has(String(current.status))) {
        res.status(409).json({ error: "cannot edit tenant notes for terminal booking status" });
        return;
      }

      const trimmed =
        tenantNotes === null ? null : tenantNotes.slice(0, TENANT_NOTES_MAX);
      const updated = await prisma.booking.update({
        where: { id: current.id },
        data: { tenantNotes: trimmed },
      });
      res.json(updated);
    } catch (error) {
      console.error("[booking] patch tenant notes failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/bookings/:bookingId/status", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = normalizeUuidPathParam(req.params.bookingId);
      if (!bid) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const next = String(req.body?.to || "").trim().toUpperCase() as BookingDomainStatus;
      const supported: BookingDomainStatus[] = ["ACCEPTED", "REJECTED", "CANCELLED", "CONFIRMED"];
      if (!supported.includes(next)) {
        res.status(400).json({ error: "invalid target status" });
        return;
      }

      const current = await prisma.booking.findUnique({ where: { id: bid } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      const from = dbToDomainStatus(String(current.status));
      if (!canTransition(from, next)) {
        res.status(409).json({ error: `invalid transition ${from} -> ${next}` });
        return;
      }

      if (next === "ACCEPTED" || next === "REJECTED") {
        if (current.landlordId !== req.userId) {
          res.status(403).json({ error: "only landlord can accept or reject" });
          return;
        }
        if (next === "ACCEPTED" && bookingExpiryDeadline(current).getTime() <= Date.now()) {
          res.status(409).json({ error: "booking expired" });
          return;
        }
        if (next === "ACCEPTED") {
          const overlapRows = await prisma.booking.findMany({
            where: {
              listingId: current.listingId,
              id: { not: current.id },
              status: { in: ["pending_confirmation", "confirmed"] },
              startDate: { lt: current.endDate },
              endDate: { gt: current.startDate },
            },
            select: { id: true },
            take: 1,
          });
          if (overlapRows.length > 0) {
            res.status(409).json({ error: "listing unavailable for selected dates" });
            return;
          }
        }
      }

      if (next === "CANCELLED") {
        const identityUsername = (req.get("x-user-username") || "").trim() || null;
        if (!tenantOwnsBooking(current, req.userId!, identityUsername)) {
          res.status(403).json({ error: "only tenant can cancel" });
          return;
        }
        if (from === "CONFIRMED" && utcCalendarToday().getTime() >= current.startDate.getTime()) {
          res.status(409).json({ error: "cannot cancel on or after lease start date" });
          return;
        }
      }

      if (next === "CONFIRMED") {
        const identityUsername = (req.get("x-user-username") || "").trim() || null;
        if (!tenantOwnsBooking(current, req.userId!, identityUsername)) {
          res.status(403).json({ error: "only tenant can confirm" });
          return;
        }
      }

      const changedBy: "tenant" | "landlord" =
        next === "ACCEPTED" || next === "REJECTED" ? "landlord" : "tenant";

      const updated = await prisma.booking.update({
        where: { id: bid },
        data: {
          status: domainToDbStatus(next),
          statusUpdatedAt: new Date(),
          confirmedAt: next === "CONFIRMED" ? new Date() : current.confirmedAt,
          cancelledAt: next === "CANCELLED" ? new Date() : current.cancelledAt,
          cancellationReason: next === "CANCELLED" ? "cancelled_by:renter" : current.cancellationReason,
        },
      });
      await emitBookingStatusUpdated(
        updated.id,
        {
          id: updated.id,
          listingId: updated.listingId,
          landlordId: updated.landlordId,
          tenantId: updated.tenantId,
          listingTitleSnapshot: updated.listingTitleSnapshot ?? null,
          tenantUsernameSnapshot: updated.tenantUsernameSnapshot ?? null,
          tenantEmailSnapshot: updated.tenantEmailSnapshot ?? null,
        },
        from,
        next,
        changedBy,
      );
      if (next === "ACCEPTED" && from === "PENDING") {
        await notifyTenantBookingAcceptedHttp({
          tenantId: updated.tenantId,
          bookingId: updated.id,
          listingId: updated.listingId,
          landlordId: updated.landlordId,
          previousStatus: from,
          listingTitle: updated.listingTitleSnapshot,
          tenantUsernameSnapshot: updated.tenantUsernameSnapshot,
          tenantEmailSnapshot: updated.tenantEmailSnapshot,
        }, getIncomingHttpOtelContext(req));
      }
      recordBookingEnteredDomainStatus(next);
      if (next === "ACCEPTED" || isTerminalStatus(next) || next === "CONFIRMED") {
        await releaseListingSoftLock(updated.listingId);
      }
      if (next === "ACCEPTED" && from === "PENDING") {
        await incrementListingBookingCount(updated.listingId);
      }
      if (next === "CANCELLED" && bookingCountsTowardRedisOccupancy(from)) {
        await decrementListingBookingCount(updated.listingId);
      }
      res.json({
        id: updated.id,
        booking_id: updated.id,
        from,
        status: next,
        to: next,
      });
    } catch (error) {
      console.error("[booking] status transition failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/bookings/:bookingId/tenant-archive", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = normalizeUuidPathParam(req.params.bookingId);
      if (!bid) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const current = await prisma.booking.findUnique({ where: { id: bid } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      const identityUsername = (req.get("x-user-username") || "").trim() || null;
      if (!tenantOwnsBooking(current, req.userId!, identityUsername)) {
        res.status(403).json({ error: "only the renter on this booking can hide or cancel it" });
        return;
      }
      const domain = dbToDomainStatus(String(current.status));
      /** Pending: cancel + archive in one step so renters can clear stuck requests from the UI. */
      if (domain === "PENDING") {
        const from = domain;
        const next: BookingDomainStatus = "CANCELLED";
        if (!canTransition(from, next)) {
          res.status(409).json({ error: "cannot cancel pending booking" });
          return;
        }
        const cancelled = await prisma.booking.update({
          where: { id: bid },
          data: {
            status: domainToDbStatus(next),
            cancellationReason: "cancelled_by:tenant_dismiss",
            cancelledAt: new Date(),
            statusUpdatedAt: new Date(),
            tenantArchivedAt: new Date(),
          },
        });
        await emitBookingStatusUpdated(
          cancelled.id,
          {
            id: cancelled.id,
            listingId: cancelled.listingId,
            landlordId: cancelled.landlordId,
            tenantId: cancelled.tenantId,
            listingTitleSnapshot: cancelled.listingTitleSnapshot ?? null,
          },
          from,
          next,
          "tenant",
        );
        await publishBookingEvent("BookingCancelledV1", cancelled.id, {
          booking_id: cancelled.id,
          listing_id: cancelled.listingId,
          cancelled_by: "tenant",
        });
        await releaseListingSoftLock(cancelled.listingId);
        recordBookingEnteredDomainStatus(next);
        res.json(bookingToPublicJson(cancelled));
        return;
      }
      /** pending_confirmation (domain ACCEPTED): renter can withdraw and hide in one step (clears stuck "upcoming"). */
      if (domain === "ACCEPTED") {
        const from = domain;
        const next: BookingDomainStatus = "CANCELLED";
        if (!canTransition(from, next)) {
          res.status(409).json({ error: "cannot withdraw booking" });
          return;
        }
        const cancelled = await prisma.booking.update({
          where: { id: bid },
          data: {
            status: domainToDbStatus(next),
            cancellationReason: "cancelled_by:tenant_dismiss",
            cancelledAt: new Date(),
            statusUpdatedAt: new Date(),
            tenantArchivedAt: new Date(),
          },
        });
        await emitBookingStatusUpdated(
          cancelled.id,
          {
            id: cancelled.id,
            listingId: cancelled.listingId,
            landlordId: cancelled.landlordId,
            tenantId: cancelled.tenantId,
            listingTitleSnapshot: cancelled.listingTitleSnapshot ?? null,
          },
          from,
          next,
          "tenant",
        );
        recordBookingEnteredDomainStatus(next);
        await publishBookingEvent("BookingCancelledV1", cancelled.id, {
          booking_id: cancelled.id,
          listing_id: cancelled.listingId,
          cancelled_by: "tenant",
        });
        await releaseListingSoftLock(cancelled.listingId);
        if (bookingCountsTowardRedisOccupancy(from)) {
          await decrementListingBookingCount(cancelled.listingId);
        }
        res.json(bookingToPublicJson(cancelled));
        return;
      }
      if (!isTerminalStatus(domain)) {
        res.status(409).json({ error: "only terminal bookings can be hidden" });
        return;
      }
      const updated = await prisma.booking.update({
        where: { id: bid },
        data: { tenantArchivedAt: new Date() },
      });
      res.json(bookingToPublicJson(updated));
    } catch (error) {
      console.error("[booking] tenant-archive failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/bookings/:bookingId/tenant-unarchive", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = normalizeUuidPathParam(req.params.bookingId);
      if (!bid) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const current = await prisma.booking.findUnique({ where: { id: bid } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (current.tenantId !== req.userId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const updated = await prisma.booking.update({
        where: { id: bid },
        data: { tenantArchivedAt: null },
      });
      res.json(bookingToPublicJson(updated));
    } catch (error) {
      console.error("[booking] tenant-unarchive failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/:bookingId/accept", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = normalizeUuidPathParam(req.params.bookingId);
      if (!bid) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const next: BookingDomainStatus = "ACCEPTED";
      const current = await prisma.booking.findUnique({ where: { id: bid } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      const from = dbToDomainStatus(String(current.status));
      if (!canTransition(from, next)) {
        res.status(409).json({ error: `invalid transition ${from} -> ${next}` });
        return;
      }
      if (current.landlordId !== req.userId) {
        res.status(403).json({ error: "only landlord can accept or reject" });
        return;
      }
      if (bookingExpiryDeadline(current).getTime() <= Date.now()) {
        res.status(409).json({ error: "booking expired" });
        return;
      }
      const overlapRows = await prisma.booking.findMany({
        where: {
          listingId: current.listingId,
          id: { not: current.id },
          status: { in: ["pending_confirmation", "confirmed"] },
          startDate: { lt: current.endDate },
          endDate: { gt: current.startDate },
        },
        select: { id: true },
        take: 1,
      });
      if (overlapRows.length > 0) {
        res.status(409).json({ error: "listing unavailable for selected dates" });
        return;
      }

      const updated = await prisma.booking.update({
        where: { id: bid },
        data: {
          status: domainToDbStatus(next),
          statusUpdatedAt: new Date(),
        },
      });
      await emitBookingStatusUpdated(
        updated.id,
        {
          id: updated.id,
          listingId: updated.listingId,
          landlordId: updated.landlordId,
          tenantId: updated.tenantId,
          listingTitleSnapshot: updated.listingTitleSnapshot ?? null,
        },
        from,
        next,
        "landlord",
      );
      await notifyTenantBookingAcceptedHttp({
        tenantId: updated.tenantId,
        bookingId: updated.id,
        listingId: updated.listingId,
        landlordId: updated.landlordId,
        previousStatus: from,
        listingTitle: updated.listingTitleSnapshot,
        tenantUsernameSnapshot: updated.tenantUsernameSnapshot,
        tenantEmailSnapshot: updated.tenantEmailSnapshot,
      }, getIncomingHttpOtelContext(req));
      recordBookingEnteredDomainStatus(next);
      await releaseListingSoftLock(updated.listingId);
      await incrementListingBookingCount(updated.listingId);
      res.json({
        id: updated.id,
        booking_id: updated.id,
        from,
        status: next,
        to: next,
      });
    } catch (error) {
      console.error("[booking] accept failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/bookings/mine", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      await handleListMineBookings(req, res);
    } catch (error) {
      console.error("[booking] list mine failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  // Backward-compatible alias for clients requesting /mine directly.
  app.get("/mine", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      await handleListMineBookings(req, res);
    } catch (error) {
      console.error("[booking] list mine alias failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/:bookingId", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = normalizeUuidPathParam(req.params.bookingId);
      if (!bid) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const booking = await prisma.booking.findUnique({ where: { id: bid } });
      if (!booking) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      const identityUsername = (req.get("x-user-username") || "").trim() || null;
      const isTenant = tenantOwnsBooking(booking, req.userId!, identityUsername);
      if (!isTenant && booking.landlordId !== req.userId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const base = bookingToPublicJson(booking);
      const listing = await resolveListingCard(booking.listingId, {
        title: booking.listingTitleSnapshot,
        priceCentsSnapshot: booking.priceCentsSnapshot,
      });
      const merged = {
        ...base,
        listing,
        landlord_display: listing.landlord_display ?? null,
      };
      const [enriched] = await enrichBookingsPartyDisplayViaTrust([merged as Record<string, unknown>]);
      res.json(enriched);
    } catch (error) {
      console.error("[booking] get failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startBookingExpirationCron(intervalMs = 60_000): NodeJS.Timeout {
  const handle = setInterval(async () => {
    try {
      const now = new Date();
      const expireCandidates = await prisma.booking.findMany({
        where: {
          status: "created",
          OR: [{ expiresAt: { lte: now } }, { AND: [{ expiresAt: null }, { createdAt: { lte: new Date(now.getTime() - 48 * 60 * 60 * 1000) } }] }],
        },
      });
      for (const row of expireCandidates) {
        const from = dbToDomainStatus(String(row.status));
        const to: BookingDomainStatus = "EXPIRED";
        if (!canTransition(from, to)) continue;
        const updated = await prisma.booking.update({
          where: { id: row.id },
          data: {
            status: "expired",
            statusUpdatedAt: new Date(),
            cancelledAt: new Date(),
            cancellationReason: "expired_by_system",
          },
        });
        await emitBookingStatusUpdated(
          updated.id,
          {
            id: updated.id,
            listingId: updated.listingId,
            landlordId: updated.landlordId,
            tenantId: updated.tenantId,
            listingTitleSnapshot: updated.listingTitleSnapshot ?? null,
          },
          from,
          to,
          "system",
        );
        bookingExpiredTotal.inc();
        recordBookingEnteredDomainStatus(to);
        await releaseListingSoftLock(updated.listingId);
      }

      const todayStart = startOfTodayUtc();
      /** Stay ended before today (UTC): do not complete while still within [startDate, endDate]. */
      const completeCandidates = await prisma.booking.findMany({
        where: {
          status: "confirmed",
          endDate: { lt: todayStart },
        },
      });
      for (const row of completeCandidates) {
        const from = dbToDomainStatus(String(row.status));
        const to: BookingDomainStatus = "COMPLETED";
        if (!canTransition(from, to)) continue;
        const updated = await prisma.booking.update({
          where: { id: row.id },
          data: {
            status: "completed",
            statusUpdatedAt: new Date(),
            completedAt: new Date(),
          },
        });
        await emitBookingStatusUpdated(
          updated.id,
          {
            id: updated.id,
            listingId: updated.listingId,
            landlordId: updated.landlordId,
            tenantId: updated.tenantId,
            listingTitleSnapshot: updated.listingTitleSnapshot ?? null,
          },
          from,
          to,
          "system",
        );
        recordBookingEnteredDomainStatus(to);
        await releaseListingSoftLock(updated.listingId);
        await decrementListingBookingCount(updated.listingId);
      }
    } catch (e) {
      console.error("[booking] lifecycle cron error", e);
    }
  }, intervalMs);
  handle.unref?.();
  return handle;
}

export async function disconnectBookingHttpKafkaProducer(): Promise<void> {
  if (!producerReady) return;
  try {
    await producer.disconnect();
  } finally {
    producerReady = false;
  }
}
