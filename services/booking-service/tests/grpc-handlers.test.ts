/**
 * Direct invocation of `bookingGrpcHandlers` + `bookingGrpcHealthCheck` (no listening server).
 */
import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const listingId = randomUUID();
const tenantId = randomUUID();
const start = "2030-06-01";
const end = "2030-06-15";

const { bookings, prismaMock } = vi.hoisted(() => {
  const bookings = new Map<
    string,
    {
      id: string;
      listingId: string;
      tenantId: string;
      landlordId: string;
      status: string;
      startDate: Date;
      endDate: Date;
      priceCentsSnapshot: number;
      currencyCode: string;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  const prismaMock = {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    booking: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  return { bookings, prismaMock };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: prismaMock,
}));

const kafkaSend = vi.fn().mockResolvedValue(undefined);
const kafkaConnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    kafka: {
      ...actual.kafka,
      producer: () => ({
        connect: kafkaConnect,
        disconnect: vi.fn().mockResolvedValue(undefined),
        send: kafkaSend,
      }),
    },
  };
});

vi.mock("@common/utils/otel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils/otel")>();
  return {
    ...actual,
    buildKafkaMessageHeaders: () => ({}),
    createGrpcServerTracingInterceptor: () => ({}),
    withKafkaProduceSpan: async (_n: string, _a: Record<string, string>, fn: () => Promise<void>) => {
      await fn();
    },
  };
});

async function invoke(
  handler: (call: { request: Record<string, unknown> }, cb: (err: unknown, res?: unknown) => void) => Promise<void>,
  request: Record<string, unknown>,
): Promise<{ err: unknown; res?: unknown }> {
  return new Promise((resolve, reject) => {
    void handler({ request }, (err, res) => {
      if (err) resolve({ err });
      else resolve({ err: null, res });
    }).catch(reject);
  });
}

function seedPrismaBookingMocks(): void {
  prismaMock.booking.create.mockImplementation(
    async ({
      data,
    }: {
      data: {
        listingId: string;
        tenantId: string;
        landlordId: string;
        status: string;
        startDate: Date;
        endDate: Date;
        priceCentsSnapshot: number;
        currencyCode: string;
      };
    }) => {
      const id = randomUUID();
      const now = new Date();
      const row = {
        id,
        listingId: data.listingId,
        tenantId: data.tenantId,
        landlordId: data.landlordId,
        status: data.status,
        startDate: data.startDate,
        endDate: data.endDate,
        priceCentsSnapshot: data.priceCentsSnapshot,
        currencyCode: data.currencyCode,
        createdAt: now,
        updatedAt: now,
      };
      bookings.set(id, row);
      return { ...row };
    },
  );
  prismaMock.booking.findUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => {
    const b = bookings.get(id);
    return b ? { ...b } : null;
  });
  prismaMock.booking.update.mockImplementation(
    async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const cur = bookings.get(id);
      if (!cur) throw new Error("booking not found");
      const next = { ...cur, ...data, updatedAt: new Date() };
      bookings.set(id, next);
      return { ...next };
    },
  );
}

describe("booking gRPC handlers (direct invoke)", () => {
  let bookingGrpcHandlers: typeof import("../src/grpc-server.js").bookingGrpcHandlers;
  let bookingGrpcHealthCheck: typeof import("../src/grpc-server.js").bookingGrpcHealthCheck;
  let toBookingResponse: typeof import("../src/grpc-server.js").toBookingResponse;

  beforeAll(async () => {
    const mod = await import("../src/grpc-server.js");
    bookingGrpcHandlers = mod.bookingGrpcHandlers;
    bookingGrpcHealthCheck = mod.bookingGrpcHealthCheck;
    toBookingResponse = mod.toBookingResponse;
  });

  beforeEach(() => {
    bookings.clear();
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    kafkaConnect.mockResolvedValue(undefined);
    kafkaSend.mockResolvedValue(undefined);
    seedPrismaBookingMocks();
  });

  it("toBookingResponse maps row fields", () => {
    const d = new Date("2030-01-02T00:00:00.000Z");
    expect(
      toBookingResponse({
        id: "b1",
        listingId: "l1",
        tenantId: "t1",
        status: "created",
        createdAt: d,
      }),
    ).toEqual({
      booking_id: "b1",
      listing_id: "l1",
      tenant_id: "t1",
      status: "created",
      created_at: d.toISOString(),
    });
  });

  it("CreateBooking — INVALID_ARGUMENT when fields missing", async () => {
    const { err } = await invoke(bookingGrpcHandlers.CreateBooking, { listing_id: listingId });
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("CreateBooking — success + kafka", async () => {
    const { err, res } = await invoke(bookingGrpcHandlers.CreateBooking, {
      listing_id: listingId,
      tenant_id: tenantId,
      start_date: start,
      end_date: end,
    });
    expect(err).toBeNull();
    expect((res as { status: string }).status).toBe("created");
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("CreateBooking — INTERNAL when prisma.create throws", async () => {
    prismaMock.booking.create.mockRejectedValueOnce(new Error("db write failed"));
    const { err } = await invoke(bookingGrpcHandlers.CreateBooking, {
      listing_id: listingId,
      tenant_id: tenantId,
      start_date: start,
      end_date: end,
    });
    expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
    expect(String((err as { message?: string }).message)).toContain("db write failed");
  });

  it("ConfirmBooking — INVALID_ARGUMENT when booking_id missing", async () => {
    const { err } = await invoke(bookingGrpcHandlers.ConfirmBooking, {});
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("ConfirmBooking — NOT_FOUND", async () => {
    const { err } = await invoke(bookingGrpcHandlers.ConfirmBooking, { booking_id: randomUUID() });
    expect((err as { code: number }).code).toBe(grpc.status.NOT_FOUND);
  });

  it("ConfirmBooking — FAILED_PRECONDITION from wrong status", async () => {
    const id = randomUUID();
    bookings.set(id, {
      id,
      listingId: listingId,
      tenantId,
      landlordId: tenantId,
      status: "confirmed",
      startDate: new Date(start),
      endDate: new Date(end),
      priceCentsSnapshot: 0,
      currencyCode: "USD",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { err } = await invoke(bookingGrpcHandlers.ConfirmBooking, { booking_id: id });
    expect((err as { code: number }).code).toBe(grpc.status.FAILED_PRECONDITION);
  });

  it("ConfirmBooking — success from created", async () => {
    const created = await prismaMock.booking.create({
      data: {
        listingId,
        tenantId,
        landlordId: tenantId,
        status: "created",
        startDate: new Date(start),
        endDate: new Date(end),
        priceCentsSnapshot: 0,
        currencyCode: "USD",
      },
    });
    const { err, res } = await invoke(bookingGrpcHandlers.ConfirmBooking, { booking_id: created.id });
    expect(err).toBeNull();
    expect((res as { status: string }).status).toBe("confirmed");
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("ConfirmBooking — success from pending_confirmation", async () => {
    const id = randomUUID();
    bookings.set(id, {
      id,
      listingId,
      tenantId,
      landlordId: tenantId,
      status: "pending_confirmation",
      startDate: new Date(start),
      endDate: new Date(end),
      priceCentsSnapshot: 0,
      currencyCode: "USD",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { err, res } = await invoke(bookingGrpcHandlers.ConfirmBooking, { booking_id: id });
    expect(err).toBeNull();
    expect((res as { status: string }).status).toBe("confirmed");
  });

  it("ConfirmBooking — INTERNAL on unexpected error", async () => {
    prismaMock.booking.findUnique.mockRejectedValueOnce(new Error("read timeout"));
    const { err } = await invoke(bookingGrpcHandlers.ConfirmBooking, { booking_id: randomUUID() });
    expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
  });

  it("CancelBooking — INVALID_ARGUMENT", async () => {
    const { err } = await invoke(bookingGrpcHandlers.CancelBooking, {});
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("CancelBooking — NOT_FOUND", async () => {
    const { err } = await invoke(bookingGrpcHandlers.CancelBooking, { booking_id: randomUUID() });
    expect((err as { code: number }).code).toBe(grpc.status.NOT_FOUND);
  });

  it("CancelBooking — FAILED_PRECONDITION when already cancelled", async () => {
    const id = randomUUID();
    bookings.set(id, {
      id,
      listingId,
      tenantId,
      landlordId: tenantId,
      status: "cancelled",
      startDate: new Date(start),
      endDate: new Date(end),
      priceCentsSnapshot: 0,
      currencyCode: "USD",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { err } = await invoke(bookingGrpcHandlers.CancelBooking, { booking_id: id });
    expect((err as { code: number }).code).toBe(grpc.status.FAILED_PRECONDITION);
  });

  it("CancelBooking — success", async () => {
    const created = await prismaMock.booking.create({
      data: {
        listingId,
        tenantId,
        landlordId: tenantId,
        status: "created",
        startDate: new Date(start),
        endDate: new Date(end),
        priceCentsSnapshot: 0,
        currencyCode: "USD",
      },
    });
    const { err, res } = await invoke(bookingGrpcHandlers.CancelBooking, { booking_id: created.id });
    expect(err).toBeNull();
    expect((res as { status: string }).status).toBe("cancelled");
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("CancelBooking — INTERNAL on unexpected error", async () => {
    prismaMock.booking.findUnique.mockRejectedValueOnce(new Error("db"));
    const { err } = await invoke(bookingGrpcHandlers.CancelBooking, { booking_id: randomUUID() });
    expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
  });

  it("GetBooking — INVALID_ARGUMENT", async () => {
    const { err } = await invoke(bookingGrpcHandlers.GetBooking, {});
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("GetBooking — NOT_FOUND", async () => {
    const { err } = await invoke(bookingGrpcHandlers.GetBooking, { booking_id: randomUUID() });
    expect((err as { code: number }).code).toBe(grpc.status.NOT_FOUND);
  });

  it("GetBooking — success", async () => {
    const created = await prismaMock.booking.create({
      data: {
        listingId,
        tenantId,
        landlordId: tenantId,
        status: "created",
        startDate: new Date(start),
        endDate: new Date(end),
        priceCentsSnapshot: 0,
        currencyCode: "USD",
      },
    });
    const { err, res } = await invoke(bookingGrpcHandlers.GetBooking, { booking_id: created.id });
    expect(err).toBeNull();
    expect((res as { booking_id: string }).booking_id).toBe(created.id);
  });

  it("GetBooking — INTERNAL on unexpected error", async () => {
    prismaMock.booking.findUnique.mockRejectedValueOnce(new Error("db"));
    const { err } = await invoke(bookingGrpcHandlers.GetBooking, { booking_id: randomUUID() });
    expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
  });

  it("bookingGrpcHealthCheck — true when SELECT 1 succeeds", async () => {
    await expect(bookingGrpcHealthCheck()).resolves.toBe(true);
  });

  it("bookingGrpcHealthCheck — false when SELECT 1 fails", async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("down"));
    await expect(bookingGrpcHealthCheck()).resolves.toBe(false);
  });
});
