import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  kafka,
  register,
  httpCounter,
  createHttpConcurrencyGuard,
} from "@common/utils";
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
    await producer.send({
      topic: BOOKING_EVENTS_TOPIC,
      messages: [{ key: aggregateId, value: JSON.stringify(message) }],
    });
  } catch (e) {
    console.warn("[booking] kafka publish skipped", e);
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

const TENANT_NOTES_MAX = 4000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function disableHistoryCaching(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.vary("x-user-id");
}

export function createBookingHttpApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "booking",
        route: req.path,
        method: req.method,
        code: res.statusCode,
      }),
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
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
      envVar: "BOOKING_HTTP_MAX_CONCURRENT",
      defaultMax: 75,
      serviceLabel: "booking-service",
    }),
  );

  app.post(
    "/dry-run",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const { listingId, startDate, endDate, landlordId, priceCents } =
          req.body as {
            listingId?: string;
            startDate?: string;
            endDate?: string;
            landlordId?: string;
            priceCents?: number;
          };

        if (!listingId || !startDate || !endDate || !req.userId) {
          res.status(400).json({
            valid: false,
            error: "listingId, startDate, endDate required",
          });
          return;
        }

        if (!UUID_RE.test(listingId)) {
          res.status(400).json({
            valid: false,
            error: "listingId must be a valid UUID",
          });
          return;
        }

        if (landlordId && !UUID_RE.test(landlordId)) {
          res.status(400).json({
            valid: false,
            error: "landlordId must be a valid UUID",
          });
          return;
        }

        const parsedStartDate = new Date(startDate);
        const parsedEndDate = new Date(endDate);

        if (
          Number.isNaN(parsedStartDate.getTime()) ||
          Number.isNaN(parsedEndDate.getTime())
        ) {
          res.status(400).json({
            valid: false,
            error: "startDate and endDate must be valid dates",
          });
          return;
        }

        if (parsedStartDate >= parsedEndDate) {
          res.status(400).json({
            valid: false,
            error: "startDate must be before endDate",
          });
          return;
        }

        const overlappingBooking = await prisma.booking.findFirst({
          where: {
            listingId,
            status: {
              not: "cancelled",
            },
            AND: [
              { startDate: { lt: parsedEndDate } },
              { endDate: { gt: parsedStartDate } },
            ],
          },
        });

        if (overlappingBooking) {
          res.status(409).json({
            valid: false,
            error: "Booking dates overlap with an existing booking",
          });
          return;
        }

        res.status(200).json({
          valid: true,
          message: "Booking request is valid",
          bookingPreview: {
            listingId,
            tenantId: req.userId,
            landlordId: landlordId || req.userId,
            status: "created",
            startDate: parsedStartDate.toISOString(),
            endDate: parsedEndDate.toISOString(),
            priceCentsSnapshot: Number.isFinite(priceCents)
              ? Number(priceCents)
              : 0,
            currencyCode: "USD",
          },
        });
      } catch (error) {
        console.error("[booking] dry-run failed", error);
        res.status(500).json({ valid: false, error: "internal" });
      }
    },
  );

  app.post(
    "/create",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const { listingId, startDate, endDate, landlordId, priceCents } =
          req.body as {
            listingId?: string;
            startDate?: string;
            endDate?: string;
            landlordId?: string;
            priceCents?: number;
          };
        if (!listingId || !startDate || !endDate || !req.userId) {
          res
            .status(400)
            .json({ error: "listingId, startDate, endDate required" });
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
            priceCentsSnapshot: Number.isFinite(priceCents)
              ? Number(priceCents)
              : 0,
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
    },
  );

  app.post(
    "/confirm",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const { bookingId, landlordId } = req.body as {
          bookingId?: string;
          landlordId?: string;
        };
        if (!bookingId) {
          res.status(400).json({ error: "bookingId required" });
          return;
        }

        const current = await prisma.booking.findUnique({
          where: { id: bookingId },
        });
        if (!current) {
          res.status(404).json({ error: "booking not found" });
          return;
        }
        if (
          current.status !== "created" &&
          current.status !== "pending_confirmation"
        ) {
          res
            .status(409)
            .json({ error: `cannot confirm from status ${current.status}` });
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
    },
  );

  app.post(
    "/cancel",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const { bookingId, cancelledBy } = req.body as {
          bookingId?: string;
          cancelledBy?: string;
        };
        if (!bookingId) {
          res.status(400).json({ error: "bookingId required" });
          return;
        }
        const actor = cancelledBy || (req.userId ? "tenant" : "unknown");
        const current = await prisma.booking.findUnique({
          where: { id: bookingId },
        });
        if (!current) {
          res.status(404).json({ error: "booking not found" });
          return;
        }
        if (
          current.tenantId !== req.userId &&
          current.landlordId !== req.userId
        ) {
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
    },
  );

  app.post(
    "/search-history",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        disableHistoryCaching(res);
        const {
          query,
          minPriceCents,
          maxPriceCents,
          maxDistanceKm,
          latitude,
          longitude,
          filters,
        } = req.body as {
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
            filters:
              (filters as Prisma.InputJsonValue | undefined) ?? undefined,
          },
        });
        res.status(201).json(row);
      } catch (error) {
        console.error("[booking] search-history create failed", error);
        res.status(500).json({ error: "internal" });
      }
    },
  );

  app.get(
    "/search-history/list",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        disableHistoryCaching(res);
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
    },
  );

  app.post(
    "/watchlist/add",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const { listingId, source } = req.body as {
          listingId?: string;
          source?: string;
        };
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
    },
  );

  app.post(
    "/watchlist/remove",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
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
    },
  );

  app.get(
    "/watchlist/list",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
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
    },
  );

  app.patch(
    "/:bookingId",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
      try {
        const bid = req.params.bookingId || "";
        if (!UUID_RE.test(bid)) {
          res.status(400).json({ error: "invalid bookingId" });
          return;
        }
        const { tenantNotes } = req.body as { tenantNotes?: string | null };
        if (!Object.prototype.hasOwnProperty.call(req.body, "tenantNotes")) {
          res
            .status(400)
            .json({ error: "tenantNotes required (string or null)" });
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
          res.status(409).json({
            error: "cannot edit tenant notes for terminal booking status",
          });
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
    },
  );

  app.get(
    "/:bookingId",
    requireUser,
    async (req: AuthedRequest, res: Response) => {
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
    },
  );

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
