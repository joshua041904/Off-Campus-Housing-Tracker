import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "node:fs";
import { PrismaClient } from "../prisma/generated/client/index.js";
import { kafka, registerHealthService, resolveProtoPath } from "@common/utils";
import { randomUUID } from "node:crypto";

const BOOKING_PROTO = resolveProtoPath("booking.proto");
const packageDefinition = protoLoader.loadSync(BOOKING_PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const bookingProto = (grpc.loadPackageDefinition(packageDefinition) as any).booking;

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
  } catch {
    // Keep service available even when Kafka is transiently down.
  }
}

async function publishBookingEvent(eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await ensureProducer();
    if (!producerReady) return;
    await producer.send({
      topic: BOOKING_EVENTS_TOPIC,
      messages: [
        {
          key: aggregateId,
          value: JSON.stringify({
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
          }),
        },
      ],
    });
  } catch {
    // Non-fatal: booking mutation already succeeded.
  }
}

function toBookingResponse(row: {
  id: string;
  listingId: string;
  tenantId: string;
  status: string;
  createdAt: Date;
}) {
  return {
    booking_id: row.id,
    listing_id: row.listingId,
    tenant_id: row.tenantId,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export function startGrpcServer(port: number): void {
  const server = new grpc.Server();

  server.addService(bookingProto.BookingService.service, {
    CreateBooking: async (call: any, callback: any) => {
      try {
        const req = call.request as {
          listing_id?: string;
          tenant_id?: string;
          start_date?: string;
          end_date?: string;
        };
        if (!req.listing_id || !req.tenant_id || !req.start_date || !req.end_date) {
          callback({ code: grpc.status.INVALID_ARGUMENT, message: "listing_id, tenant_id, start_date, end_date required" });
          return;
        }
        const created = await prisma.booking.create({
          data: {
            listingId: req.listing_id,
            tenantId: req.tenant_id,
            landlordId: req.tenant_id,
            status: "created" as const,
            startDate: new Date(req.start_date),
            endDate: new Date(req.end_date),
            priceCentsSnapshot: 0,
            currencyCode: "USD",
          },
        });
        await publishBookingEvent("BookingCreatedV1", created.id, {
          booking_id: created.id,
          listing_id: created.listingId,
          tenant_id: created.tenantId,
          start_date: created.startDate.toISOString(),
          end_date: created.endDate.toISOString(),
        });
        callback(null, toBookingResponse(created));
      } catch (error: any) {
        callback({ code: grpc.status.INTERNAL, message: error?.message || "internal" });
      }
    },
    ConfirmBooking: async (call: any, callback: any) => {
      try {
        const bookingId = String(call.request?.booking_id || "");
        if (!bookingId) {
          callback({ code: grpc.status.INVALID_ARGUMENT, message: "booking_id required" });
          return;
        }
        const current = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!current) {
          callback({ code: grpc.status.NOT_FOUND, message: "booking not found" });
          return;
        }
        if (current.status !== "created" && current.status !== "pending_confirmation") {
          callback({ code: grpc.status.FAILED_PRECONDITION, message: `cannot confirm from status ${current.status}` });
          return;
        }
        await prisma.booking.update({
          where: { id: bookingId },
          data: { status: "pending_confirmation" as const },
        });
        const updated = await prisma.booking.update({
          where: { id: bookingId },
          data: { status: "confirmed" as const, confirmedAt: new Date() },
        });
        await publishBookingEvent("BookingConfirmedV1", updated.id, {
          booking_id: updated.id,
          listing_id: updated.listingId,
          tenant_id: updated.tenantId,
          landlord_id: updated.landlordId || "",
        });
        callback(null, toBookingResponse(updated));
      } catch (error: any) {
        callback({ code: grpc.status.INTERNAL, message: error?.message || "internal" });
      }
    },
    CancelBooking: async (call: any, callback: any) => {
      try {
        const bookingId = String(call.request?.booking_id || "");
        if (!bookingId) {
          callback({ code: grpc.status.INVALID_ARGUMENT, message: "booking_id required" });
          return;
        }
        const current = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!current) {
          callback({ code: grpc.status.NOT_FOUND, message: "booking not found" });
          return;
        }
        if (current.status === "cancelled") {
          callback({ code: grpc.status.FAILED_PRECONDITION, message: "booking already cancelled" });
          return;
        }
        const updated = await prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: "cancelled" as const,
            cancellationReason: "cancelled_by:tenant",
            cancelledAt: new Date(),
          },
        });
        await publishBookingEvent("BookingCancelledV1", updated.id, {
          booking_id: updated.id,
          listing_id: updated.listingId,
          cancelled_by: "tenant",
        });
        callback(null, toBookingResponse(updated));
      } catch (error: any) {
        callback({ code: grpc.status.INTERNAL, message: error?.message || "internal" });
      }
    },
    GetBooking: async (call: any, callback: any) => {
      try {
        const bookingId = String(call.request?.booking_id || "");
        if (!bookingId) {
          callback({ code: grpc.status.INVALID_ARGUMENT, message: "booking_id required" });
          return;
        }
        const current = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!current) {
          callback({ code: grpc.status.NOT_FOUND, message: "booking not found" });
          return;
        }
        callback(null, toBookingResponse(current));
      } catch (error: any) {
        callback({ code: grpc.status.INTERNAL, message: error?.message || "internal" });
      }
    },
  });

  registerHealthService(server, "booking.BookingService", async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  });

  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  const caPath = process.env.TLS_CA_PATH || "/etc/certs/ca.crt";
  const requireClientCert = process.env.GRPC_REQUIRE_CLIENT_CERT === "true";

  let credentials: grpc.ServerCredentials;
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    const rootCerts = fs.existsSync(caPath) ? fs.readFileSync(caPath) : null;
    credentials = grpc.ServerCredentials.createSsl(rootCerts, [{ private_key: key, cert_chain: cert }], requireClientCert as any);
    console.log("[booking gRPC] TLS enabled; client cert required:", requireClientCert);
  } else {
    console.warn("[booking gRPC] TLS certs not found, starting insecure (dev only)");
    credentials = grpc.ServerCredentials.createInsecure();
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err: Error | null, boundPort: number) => {
    if (err) {
      console.error("[booking gRPC] bind error:", err);
      return;
    }
    server.start();
    console.log(`[booking gRPC] listening on ${boundPort}`);
  });
}
