import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { kafka, register, httpCounter, createHttpConcurrencyGuard } from "@common/utils";
import {
  buildKafkaMessageHeaders,
  inferNetProtoForSpan,
  mountDebugTraceHeaders,
  tracingMiddleware,
  withKafkaProduceSpan,
} from "@common/utils/otel";
import { Prisma } from "../prisma/generated/client/index.js";
import { prisma } from "./lib/prisma.js";
import { randomUUID } from "node:crypto";
import { BOOKING_EVENTS_TOPIC } from "./grpc-server.js";

type AuthedRequest = Request & { userId?: string };

const SERVICE_NAME = "booking-service";

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
      },
    );
  } catch (e) {
    console.warn("[booking] kafka publish skipped", e);
  }
}

function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = (req.get("x-user-id") || "").trim();
  if (!userId) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  req.userId = userId;
  next();
}

const TENANT_NOTES_MAX = 4000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createBookingHttpApp(): Express {
  const app = express();
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

      const booking = await prisma.booking.create({
        data: {
          listingId,
          tenantId: req.userId,
          landlordId: landlordId || req.userId,
          status: "created" as const,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          priceCentsSnapshot: Number.isFinite(priceCents) ? Number(priceCents) : 0,
          currencyCode: "USD",
        },
      });

      await publishBookingEvent("BookingCreatedV1", booking.id, {
        booking_id: booking.id,
        listing_id: booking.listingId,
        tenant_id: booking.tenantId,
        start_date: booking.startDate.toISOString(),
        end_date: booking.endDate.toISOString(),
      });

      res.status(201).json(booking);
    } catch (error) {
      console.error("[booking] create failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/confirm", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { bookingId, landlordId } = req.body as { bookingId?: string; landlordId?: string };
      if (!bookingId) {
        res.status(400).json({ error: "bookingId required" });
        return;
      }

      const current = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (current.status !== "created" && current.status !== "pending_confirmation") {
        res.status(409).json({ error: `cannot confirm from status ${current.status}` });
        return;
      }

      const landlord = landlordId || current.landlordId;
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "pending_confirmation" as const },
      });
      const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "confirmed" as const,
          landlordId: landlord,
          confirmedAt: new Date(),
        },
      });

      await publishBookingEvent("BookingConfirmedV1", updated.id, {
        booking_id: updated.id,
        listing_id: updated.listingId,
        tenant_id: updated.tenantId,
        landlord_id: updated.landlordId || "",
      });

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
      const actor = cancelledBy || (req.userId ? "tenant" : "unknown");
      const current = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!current) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (current.tenantId !== req.userId && current.landlordId !== req.userId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (current.status === "cancelled") {
        res.status(409).json({ error: "booking already cancelled" });
        return;
      }

      const updated = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "cancelled" as const,
          cancellationReason: `cancelled_by:${actor}`,
          cancelledAt: new Date(),
        },
      });

      await publishBookingEvent("BookingCancelledV1", updated.id, {
        booking_id: updated.id,
        listing_id: updated.listingId,
        cancelled_by: actor,
      });

      res.json(updated);
    } catch (error) {
      console.error("[booking] cancel failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/search-history", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const { query, minPriceCents, maxPriceCents, maxDistanceKm, latitude, longitude, filters } = req.body as {
        query?: string;
        minPriceCents?: number;
        maxPriceCents?: number;
        maxDistanceKm?: number;
        latitude?: number;
        longitude?: number;
        filters?: Record<string, unknown>;
      };
      const row = await prisma.searchHistory.create({
        data: {
          userId: req.userId!,
          query: query || null,
          minPriceCents: minPriceCents ?? null,
          maxPriceCents: maxPriceCents ?? null,
          maxDistanceKm: maxDistanceKm ?? null,
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
      res.status(201).json(item);
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
      res.json({
        ok: true,
        removed: updated.count,
        message: "Removed from watchlist",
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
  ): Promise<{ landlordId: string; priceCents: number } | null> {
    const base = (process.env.LISTINGS_HTTP || "http://127.0.0.1:4012").replace(/\/$/, "");
    const url = `${base}/listings/${listingId}`;
    let upstream: globalThis.Response;
    try {
      const ms = Number(process.env.BOOKING_LISTING_FETCH_TIMEOUT_MS ?? "12000");
      const timeout = Number.isFinite(ms) ? Math.min(120_000, Math.max(1000, ms)) : 12_000;
      upstream = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new Error("listings_fetch_failed");
    }
    if (upstream.status === 404) return null;
    if (!upstream.ok) throw new Error(`listings_http_${upstream.status}`);
    const j = (await upstream.json()) as Record<string, unknown>;
    const landlordId = String(j.landlord_id ?? j.user_id ?? "").trim();
    if (!UUID_RE.test(landlordId)) return null;
    let priceCents = Number(j.price_cents);
    if (!Number.isFinite(priceCents) && typeof j.price === "number") {
      priceCents = Math.round(j.price * 100);
    }
    if (!Number.isFinite(priceCents)) priceCents = 0;
    return { landlordId, priceCents };
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
      const day = String(requested_date).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        res.status(400).json({ error: "requested_date must be YYYY-MM-DD" });
        return;
      }

      let meta: { landlordId: string; priceCents: number } | null;
      try {
        meta = await fetchListingForBookingRequest(listing_id);
      } catch {
        res.status(502).json({ error: "listing fetch failed" });
        return;
      }
      if (!meta) {
        res.status(404).json({ error: "listing not found" });
        return;
      }

      const startDate = new Date(`${day}T00:00:00.000Z`);
      const endDate = new Date(`${day}T00:00:00.000Z`);
      const note =
        message != null && String(message).trim() !== ""
          ? String(message).slice(0, TENANT_NOTES_MAX)
          : null;

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
        },
      });

      await publishBookingEvent("BookingRequestV1", booking.id, {
        booking_id: booking.id,
        listing_id: booking.listingId,
        tenant_id: booking.tenantId,
        requested_date: day,
        message_present: Boolean(note),
      });

      res.status(201).json({
        ok: true,
        booking_id: booking.id,
        listing_id: booking.listingId,
        landlord_id: booking.landlordId,
        tenant_id: booking.tenantId,
        requested_date: day,
        status: booking.status,
      });
    } catch (error) {
      console.error("[booking] request failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  app.patch("/:bookingId", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = req.params.bookingId || "";
      if (!UUID_RE.test(bid)) {
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
      if (current.status === "cancelled" || current.status === "completed") {
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

  app.get("/:bookingId", requireUser, async (req: AuthedRequest, res: Response) => {
    try {
      const bid = req.params.bookingId || "";
      if (!UUID_RE.test(bid)) {
        res.status(400).json({ error: "invalid bookingId" });
        return;
      }
      const booking = await prisma.booking.findUnique({ where: { id: bid } });
      if (!booking) {
        res.status(404).json({ error: "booking not found" });
        return;
      }
      if (booking.tenantId !== req.userId) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.json(booking);
    } catch (error) {
      console.error("[booking] get failed", error);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export async function disconnectBookingHttpKafkaProducer(): Promise<void> {
  if (!producerReady) return;
  try {
    await producer.disconnect();
  } finally {
    producerReady = false;
  }
}
