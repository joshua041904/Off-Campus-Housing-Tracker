import express, { type NextFunction, type Request, type Response } from "express";
import { kafka, register, httpCounter } from "@common/utils";
import { Prisma, PrismaClient } from "../prisma/generated/client/index.js";
import { randomUUID } from "node:crypto";
import { startGrpcServer } from "./grpc-server.js";

type AuthedRequest = Request & { userId?: string };

const HTTP_PORT = Number(process.env.HTTP_PORT || "4013");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50063");
const BOOKING_EVENTS_TOPIC = process.env.BOOKING_EVENTS_TOPIC || "dev.booking.events.v1";
const SERVICE_NAME = "booking-service";

const prisma = new PrismaClient();
const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  try {
    const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
    await Promise.race([
      producer.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("kafka connect timeout")), connectMs)),
    ]);
    producerReady = true;
    console.log("[booking] kafka producer connected");
  } catch (error) {
    console.warn("[booking] kafka producer unavailable, continuing without event publish", error);
  }
}

async function publishBookingEvent(eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
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
    await producer.send({
      topic: BOOKING_EVENTS_TOPIC,
      messages: [{ key: aggregateId, value: JSON.stringify(message) }],
    });
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

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.on("finish", () =>
    httpCounter.inc({ service: "booking", route: req.path, method: req.method, code: res.statusCode })
  );
  next();
});

app.get(["/healthz", "/health"], async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true, db: "connected" });
  } catch (error) {
    res.status(200).json({ ok: true, db: "disconnected", warning: "database unavailable" });
  }
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

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
    // Two separate commits: GiST exclusion can false-positive "overlap with self" inside one transaction.
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
    res.json({ ok: true, removed: updated.count });
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

app.get("/:bookingId", requireUser, async (req: AuthedRequest, res: Response) => {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.bookingId } });
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

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`[booking] HTTP server listening on port ${HTTP_PORT}`);
});

startGrpcServer(GRPC_PORT);

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  if (producerReady) await producer.disconnect();
  process.exit(0);
});
