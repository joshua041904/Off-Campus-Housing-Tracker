/**
 * Phase B: minimal HTTP surface on createBookingHttpApp() with mocked Prisma + Kafka helpers.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Express } from "express";

const listingId = randomUUID();
const tenantId = randomUUID();
const otherTenant = randomUUID();
const landlordId = randomUUID();
const start = "2030-06-01";
const end = "2030-06-15";

const { notifyLandlordBookingRequestHttpMock, notifyTenantBookingAcceptedHttpMock } = vi.hoisted(() => ({
  notifyLandlordBookingRequestHttpMock: vi.fn().mockResolvedValue(undefined),
  notifyTenantBookingAcceptedHttpMock: vi.fn().mockResolvedValue(undefined),
}));

const { bookings, searchHistoryRows, watchByComposite, prismaMock } = vi.hoisted(() => {
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
      tenantNotes: string | null;
      cancellationReason: string | null;
      confirmedAt: Date | null;
      cancelledAt: Date | null;
      completedAt: Date | null;
      expiresAt: Date | null;
      fraudScore: number | null;
      fraudFlagged: boolean;
      fraudSignals: unknown;
      fraudReviewStatus: string | null;
      listingTitleSnapshot: string | null;
      tenantEmailSnapshot: string | null;
      tenantUsernameSnapshot: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  const searchHistoryRows: Array<Record<string, unknown>> = [];
  const watchByComposite = new Map<string, Record<string, unknown>>();

  function baseRow(data: {
    id: string;
    listingId: string;
    tenantId: string;
    landlordId: string;
    status: string;
    startDate: Date;
    endDate: Date;
    priceCentsSnapshot: number;
  }) {
    const now = new Date();
    return {
      ...data,
      currencyCode: "USD",
      tenantNotes: null as string | null,
      cancellationReason: null as string | null,
      confirmedAt: null as Date | null,
      cancelledAt: null as Date | null,
      completedAt: null as Date | null,
      expiresAt: null as Date | null,
      fraudScore: null as number | null,
      fraudFlagged: false,
      fraudSignals: null as unknown,
      fraudReviewStatus: null as string | null,
      listingTitleSnapshot: null as string | null,
      tenantEmailSnapshot: null as string | null,
      tenantUsernameSnapshot: null as string | null,
      tenantArchivedAt: null as Date | null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const prismaMock = {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    booking: {
      create: vi.fn(
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
            tenantNotes?: string | null;
          };
        }) => {
          const id = randomUUID();
          const row = baseRow({
            id,
            listingId: data.listingId,
            tenantId: data.tenantId,
            landlordId: data.landlordId,
            status: data.status,
            startDate: data.startDate,
            endDate: data.endDate,
            priceCentsSnapshot: data.priceCentsSnapshot,
          });
          const next = {
            ...row,
            tenantNotes: data.tenantNotes ?? null,
            listingTitleSnapshot:
              (data as { listingTitleSnapshot?: string | null }).listingTitleSnapshot ?? row.listingTitleSnapshot,
            tenantEmailSnapshot:
              (data as { tenantEmailSnapshot?: string | null }).tenantEmailSnapshot ?? row.tenantEmailSnapshot,
            tenantUsernameSnapshot:
              (data as { tenantUsernameSnapshot?: string | null }).tenantUsernameSnapshot ?? row.tenantUsernameSnapshot,
          };
          bookings.set(id, next);
          return { ...next };
        },
      ),
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const b = bookings.get(id);
        return b ? { ...b } : null;
      }),
      update: vi.fn(
        async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const cur = bookings.get(id);
          if (!cur) throw new Error("booking not found");
          const next = { ...cur, ...data, updatedAt: new Date() };
          bookings.set(id, next);
          return { ...next };
        },
      ),
      delete: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const cur = bookings.get(id);
        if (!cur) throw new Error("booking not found");
        bookings.delete(id);
        return { ...cur };
      }),
      count: vi.fn(
        async ({
          where,
        }: {
          where?: {
            tenantId?: string;
            landlordId?: string;
            status?: string;
            fraudFlagged?: boolean;
            fraudReviewStatus?: null;
            createdAt?: { gte?: Date };
            OR?: unknown[];
          };
        }) => {
          let rows = [...bookings.values()];
          if (where?.tenantId) rows = rows.filter((b) => b.tenantId === where.tenantId);
          if (where?.landlordId) rows = rows.filter((b) => b.landlordId === where.landlordId);
          if (where?.status) rows = rows.filter((b) => b.status === where.status);
          if (where?.fraudFlagged === true) rows = rows.filter((b) => b.fraudFlagged === true);
          if (where && "fraudReviewStatus" in where && where.fraudReviewStatus === null) {
            rows = rows.filter((b) => b.fraudReviewStatus == null);
          }
          const gte = where?.createdAt?.gte;
          if (gte) {
            rows = rows.filter((b) => new Date(b.createdAt).getTime() >= new Date(gte).getTime());
          }
          return rows.length;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where?: Record<string, unknown>;
          orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
          take?: number;
        }) => {
          const matchesClause = (b: (typeof bookings extends Map<string, infer V> ? V : never), clause: Record<string, unknown>): boolean => {
            if (clause.AND && Array.isArray(clause.AND)) {
              return clause.AND.every((part) => matchesClause(b, part as Record<string, unknown>));
            }
            if (clause.OR && Array.isArray(clause.OR)) {
              return clause.OR.some((part) => matchesClause(b, part as Record<string, unknown>));
            }
            if (clause.tenantId && b.tenantId !== clause.tenantId) return false;
            if (clause.landlordId && b.landlordId !== clause.landlordId) return false;
            if (clause.status && typeof clause.status === "string" && b.status !== clause.status) return false;
            const statusIn = (clause.status as { in?: string[] } | undefined)?.in;
            if (statusIn && !statusIn.includes(b.status)) return false;
            const endGte = (clause.endDate as { gte?: Date } | undefined)?.gte;
            if (endGte && new Date(b.endDate).getTime() < new Date(endGte).getTime()) return false;
            const endLt = (clause.endDate as { lt?: Date } | undefined)?.lt;
            if (endLt && new Date(b.endDate).getTime() >= new Date(endLt).getTime()) return false;
            if ("tenantArchivedAt" in clause && clause.tenantArchivedAt === null && b.tenantArchivedAt) {
              return false;
            }
            const snap = clause.tenantUsernameSnapshot;
            if (typeof snap === "string" && b.tenantUsernameSnapshot !== snap) return false;
            if (
              snap &&
              typeof snap === "object" &&
              (snap as { startsWith?: string }).startsWith &&
              typeof b.tenantUsernameSnapshot === "string" &&
              !b.tenantUsernameSnapshot.startsWith((snap as { startsWith: string }).startsWith)
            ) {
              return false;
            }
            return true;
          };

          let rows = [...bookings.values()].filter((b) => matchesClause(b, where ?? {}));
          const orderList = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
          if (orderList.length > 0) {
            rows.sort((a, b) => {
              for (const key of orderList) {
                const entry = key as Record<string, "asc" | "desc">;
                if (entry.startDate) {
                  const cmp = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
                  if (cmp !== 0) return entry.startDate === "desc" ? -cmp : cmp;
                }
                if (entry.updatedAt) {
                  const cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
                  if (cmp !== 0) return entry.updatedAt === "desc" ? -cmp : cmp;
                }
                if (entry.createdAt) {
                  const cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                  if (cmp !== 0) return entry.createdAt === "desc" ? -cmp : cmp;
                }
              }
              return 0;
            });
          }
          return rows.slice(0, take ?? rows.length);
        },
      ),
      findFirst: vi.fn(
        async ({ where, orderBy, select }: { where?: { tenantId?: string }; orderBy?: { createdAt?: "asc" | "desc" }; select?: { createdAt?: boolean } }) => {
          const tenantId = where?.tenantId;
          const rows = [...bookings.values()].filter((b) => (!tenantId ? true : b.tenantId === tenantId));
          rows.sort((a, b) => {
            const dir = orderBy?.createdAt === "desc" ? -1 : 1;
            return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
          });
          const first = rows[0];
          if (!first) return null;
          if (select?.createdAt) return { createdAt: first.createdAt };
          return { ...first };
        },
      ),
    },
    searchHistory: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = randomUUID();
        const row = { id, ...data, createdAt: new Date() };
        searchHistoryRows.push(row as never);
        return { ...row };
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: { userId?: string; alertOnMatch?: boolean; createdAt?: { gte?: Date } };
          take: number;
        }) => {
          let rows = [...searchHistoryRows] as Array<Record<string, unknown>>;
          if (where.userId) rows = rows.filter((r) => r.userId === where.userId);
          if (where.alertOnMatch === true) rows = rows.filter((r) => r.alertOnMatch === true);
          if (where.createdAt?.gte) {
            const t = where.createdAt.gte.getTime();
            rows = rows.filter((r) => new Date(String(r.createdAt)).getTime() >= t);
          }
          return rows.slice(0, take ?? 500);
        },
      ),
    },
    watchlistItem: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId_listingId: { userId: string; listingId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = `${where.userId_listingId.userId}:${where.userId_listingId.listingId}`;
          const existing = watchByComposite.get(key);
          const now = new Date();
          if (existing) {
            const next = { ...existing, ...update, updatedAt: now };
            watchByComposite.set(key, next);
            return { ...next };
          }
          const row = {
            id: randomUUID(),
            ...create,
            addedAt: now,
            isActive: true,
          };
          watchByComposite.set(key, row);
          return { ...row };
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string; listingId: string; isActive: boolean };
          data: Record<string, unknown>;
        }) => {
          const key = `${where.userId}:${where.listingId}`;
          const cur = watchByComposite.get(key);
          if (!cur || !cur.isActive) return { count: 0 };
          watchByComposite.set(key, { ...cur, ...data });
          return { count: 1 };
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { userId: string; isActive: boolean } }) =>
        [...watchByComposite.values()].filter(
          (w: { userId: string; isActive: boolean }) => w.userId === where.userId && w.isActive === where.isActive,
        ),
      ),
      count: vi.fn(
        async ({ where }: { where: { listingId: string; isActive?: boolean } }) =>
          [...watchByComposite.values()].filter(
            (w: { listingId: string; isActive: boolean }) =>
              w.listingId === where.listingId && (where.isActive === undefined || w.isActive === where.isActive),
          ).length,
      ),
      groupBy: vi.fn(
        async ({
          by,
          where,
        }: {
          by: string[];
          where: { listingId: { in: string[] }; isActive: boolean };
        }) => {
          if (!by.includes("listingId")) return [];
          const ids = where.listingId.in;
          const rows: Array<{ listingId: string; _count: { _all: number } }> = [];
          for (const lid of ids) {
            const n = [...watchByComposite.values()].filter(
              (w: { listingId: string; isActive: boolean }) => w.listingId === lid && w.isActive === where.isActive,
            ).length;
            if (n > 0) rows.push({ listingId: lid, _count: { _all: n } });
          }
          return rows;
        },
      ),
    },
  };

  return { bookings, searchHistoryRows, watchByComposite, prismaMock };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("../src/trust-events.js", () => ({
  publishTrustEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/trust-display-resolve.js", () => ({
  trustPublicIdentityForUserId: vi.fn().mockResolvedValue(null),
  trustPublicIdentitiesForUserIds: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../src/booking-realtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/booking-realtime.js")>();
  return {
    ...actual,
    acquireListingSoftLock: vi.fn().mockResolvedValue(true),
    releaseListingSoftLock: vi.fn().mockResolvedValue(undefined),
    incrementListingBookingCount: vi.fn().mockResolvedValue(1),
    decrementListingBookingCount: vi.fn().mockResolvedValue(0),
    computeFraudScore: vi.fn().mockResolvedValue({ score: 0, flagged: false, factors: [] }),
    isTenantBookingBanned: vi.fn().mockResolvedValue(false),
    persistTenantBookingBan: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../src/notify-landlord-booking-request.js", () => ({
  notifyLandlordBookingRequestHttp: (...args: unknown[]) => notifyLandlordBookingRequestHttpMock(...args),
}));

vi.mock("../src/notify-tenant-booking-accepted.js", () => ({
  notifyTenantBookingAcceptedHttp: (...args: unknown[]) => notifyTenantBookingAcceptedHttpMock(...args),
}));

const kafkaSend = vi.fn().mockResolvedValue(undefined);
const kafkaConnect = vi.fn().mockResolvedValue(undefined);
const kafkaDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    kafka: {
      ...actual.kafka,
      producer: () => ({
        connect: kafkaConnect,
        disconnect: kafkaDisconnect,
        send: kafkaSend,
      }),
    },
    register: {
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      metrics: vi.fn().mockResolvedValue("# booking test metrics\n"),
      registerMetric: vi.fn(),
    },
    httpCounter: { inc: vi.fn() },
    createHttpConcurrencyGuard: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("@common/utils/otel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils/otel")>();
  return {
    ...actual,
    tracingMiddleware: (req: unknown, res: unknown, next: () => void) => next(),
    mountDebugTraceHeaders: () => {},
    inferNetProtoForSpan: () => "http",
    buildKafkaMessageHeaders: () => ({}),
    withKafkaProduceSpan: async (_n: string, _a: Record<string, string>, fn: () => Promise<void>) => {
      await fn();
    },
  };
});

describe("createBookingHttpApp (mocked DB)", () => {
  let app: Express;

  beforeAll(async () => {
    const mod = await import("../src/http-app.js");
    app = mod.createBookingHttpApp();
  });

  afterAll(async () => {
    const mod = await import("../src/http-app.js");
    await mod.disconnectBookingHttpKafkaProducer().catch(() => {});
  });

  beforeEach(() => {
    bookings.clear();
    searchHistoryRows.length = 0;
    watchByComposite.clear();
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ landlord_id: landlordId, price_cents: 9900, title: "Spec listing" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET /healthz — DB ok → connected", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "connected" });
  });

  it("GET /healthz — DB throws → disconnected warning", async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, db: "disconnected", warning: "database unavailable" });
  });

  it("GET /metrics returns exposition body", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(String(res.text)).toContain("booking test metrics");
  });

  it("POST /create — missing x-user-id → 401", async () => {
    const res = await request(app).post("/create").send({ listingId, startDate: start, endDate: end });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing x-user-id");
  });

  it("POST /create — missing fields → 400", async () => {
    const res = await request(app).post("/create").set("x-user-id", tenantId).send({ listingId });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("listingId, startDate, endDate");
  });

  it("POST /create — success → 201", async () => {
    const res = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId, startDate: start, endDate: end, landlordId, priceCents: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.listingId).toBe(listingId);
    expect(res.body.tenantId).toBe(tenantId);
    expect(res.body.landlordId).toBe(landlordId);
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("POST /create — 404 when listing cannot be resolved and landlordId omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    );
    const res = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId, startDate: start, endDate: end });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/listing not found/i);
  });

  it("POST /request — 400 missing fields", async () => {
    const res = await request(app).post("/request").set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("POST /request — 403 renter mismatch", async () => {
    const res = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .send({
        listing_id: listingId,
        renter_id: otherTenant,
        requested_date: "2030-07-01",
      });
    expect(res.status).toBe(403);
  });

  it("POST /request — 404 when listing missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    );
    const res = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .set("x-user-email", "tomwang04312@example.com")
      .set("x-user-username", "tomwang04312_507ab69b2d")
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-01",
      });
    expect(res.status).toBe(404);
  });

  it("POST /request — 201 creates booking", async () => {
    const res = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .set("x-user-email", "tomwang04312@example.com")
      .set("x-user-username", "tomwang04312_507ab69b2d")
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-01",
        message: "Tour?",
      });
    expect(res.status).toBe(201);
    expect(res.body.booking_id).toBeTruthy();
    expect(res.body.landlord_id).toBe(landlordId);
    expect(res.body.status).toBe("PENDING");
    expect(kafkaSend).toHaveBeenCalled();
  });

  /** Contract with notification-service: envelope shape must stay aligned (topic ≠ event type). */
  it("POST /request — emits BookingRequestV1 Kafka envelope with landlord_id, tenant_id, listing_id", async () => {
    kafkaSend.mockClear();
    const res = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .set("x-user-email", "tomwang04312@example.com")
      .set("x-user-username", "tomwang04312_507ab69b2d")
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-02",
        message: "Contract check",
      });
    expect(res.status).toBe(201);
    const bookingId = String(res.body.booking_id);
    expect(bookingId).toMatch(/^[0-9a-f-]{36}$/i);

    const sendCalls = kafkaSend.mock.calls as unknown[][];
    const bookingReqCalls = sendCalls.filter((c) => {
      const arg = c[0] as { topic?: string; messages?: Array<{ value?: string }> };
      const raw = arg?.messages?.[0]?.value;
      if (!raw) return false;
      try {
        const j = JSON.parse(raw) as { metadata?: { event_type?: string } };
        return j.metadata?.event_type === "BookingRequestV1";
      } catch {
        return false;
      }
    });
    expect(bookingReqCalls.length).toBeGreaterThanOrEqual(1);

    const threadEnsureCalls = sendCalls.filter((c) => {
      const arg = c[0] as { topic?: string; messages?: Array<{ value?: string }> };
      const raw = arg?.messages?.[0]?.value;
      if (!raw) return false;
      try {
        const j = JSON.parse(raw) as { metadata?: { event_type?: string } };
        return j.metadata?.event_type === "booking.thread.ensure";
      } catch {
        return false;
      }
    });
    expect(threadEnsureCalls.length).toBeGreaterThanOrEqual(1);

    const first = bookingReqCalls[0]![0] as {
      topic: string;
      messages: Array<{ key?: string; value?: string }>;
    };
    const body = JSON.parse(first.messages[0]!.value!) as {
      metadata: {
        event_type?: string;
        aggregate_id?: string;
      };
      payload: Record<string, unknown>;
    };

    // CI isolates topics with OCH_KAFKA_TOPIC_SUFFIX (e.g. dev.booking.events.v1.<runId>-booking-service).
    expect(first.topic).toMatch(/booking\.events\.v1/);
    expect(body.metadata.event_type).toBe("BookingRequestV1");
    expect(body.metadata.aggregate_id).toBe(bookingId);
    expect(String(body.payload.landlord_id)).toBe(landlordId);
    expect(String(body.payload.listing_id)).toBe(listingId);
    expect(String(body.payload.tenant_id)).toBe(tenantId);
    expect(String(body.payload.renter_id)).toBe(tenantId);
    expect(String(body.payload.booking_id)).toBe(bookingId);
    expect(String(body.payload.tenant_username)).toBe("tomwang04312_507ab69b2d");
    expect(String(body.payload.tenant_username_snapshot)).toBe("tomwang04312_507ab69b2d");
  });

  it("POST /request — sends landlord notification payload with booking, listing, tenant, and identity snapshots", async () => {
    const res = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .set("x-user-email", "tomwang04312@example.com")
      .set("x-user-username", "tomwang04312_507ab69b2d")
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-03",
      });

    expect(res.status).toBe(201);
    expect(notifyLandlordBookingRequestHttpMock).toHaveBeenCalled();
    expect(notifyLandlordBookingRequestHttpMock.mock.calls[0]?.[0]).toMatchObject({
      landlordId,
      bookingId: res.body.booking_id,
      listingId,
      tenantId,
      tenantUsername: "tomwang04312_507ab69b2d",
      tenantUsernameSnapshot: "tomwang04312_507ab69b2d",
      tenantEmail: "tomwang04312@example.com",
      bookingStatus: "PENDING",
    });
  });

  it("POST /bookings/:id/status — landlord can accept pending booking", async () => {
    const create = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-01",
      });
    expect(create.status).toBe(201);
    const bookingId = String(create.body.booking_id);

    const update = await request(app)
      .post(`/bookings/${bookingId}/status`)
      .set("x-user-id", landlordId)
      .send({ to: "ACCEPTED" });

    expect(update.status).toBe(200);
    expect(update.body.status).toBe("ACCEPTED");
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("POST /bookings/:id/status — notifies tenant when landlord accepts a booking", async () => {
    const create = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-04",
      });
    expect(create.status).toBe(201);
    const bookingId = String(create.body.booking_id);

    const update = await request(app)
      .post(`/bookings/${bookingId}/status`)
      .set("x-user-id", landlordId)
      .send({ to: "ACCEPTED" });

    expect(update.status).toBe(200);
    expect(notifyTenantBookingAcceptedHttpMock).toHaveBeenCalled();
    expect(notifyTenantBookingAcceptedHttpMock.mock.calls.at(-1)?.[0]).toMatchObject({
      tenantId,
      bookingId,
      listingId,
      landlordId,
      previousStatus: "PENDING",
    });
  });

  it("POST /bookings/:id/status — rejects invalid transition", async () => {
    const create = await request(app)
      .post("/request")
      .set("x-user-id", tenantId)
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-01",
      });
    const bookingId = String(create.body.booking_id);

    await request(app)
      .post(`/bookings/${bookingId}/status`)
      .set("x-user-id", landlordId)
      .send({ to: "ACCEPTED" })
      .expect(200);

    const invalid = await request(app)
      .post(`/bookings/${bookingId}/status`)
      .set("x-user-id", landlordId)
      .send({ to: "REJECTED" });

    expect(invalid.status).toBe(409);
  });

  it("GET /:bookingId — invalid id → 400", async () => {
    const res = await request(app).get("/not-a-uuid").set("x-user-id", tenantId);
    expect(res.status).toBe(400);
  });

  it("GET /:bookingId — not found → 404", async () => {
    const res = await request(app).get(`/${randomUUID()}`).set("x-user-id", tenantId);
    expect(res.status).toBe(404);
  });

  it("GET /:bookingId — wrong tenant → 403", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).get(`/${id}`).set("x-user-id", otherTenant);
    expect(res.status).toBe(403);
  });

  it("GET /:bookingId — success", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 100),
    );
    const res = await request(app).get(`/${id}`).set("x-user-id", tenantId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it("POST /cancel — missing bookingId → 400", async () => {
    const res = await request(app).post("/cancel").set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("POST /cancel — not found → 404", async () => {
    const res = await request(app).post("/cancel").set("x-user-id", tenantId).send({ bookingId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it("POST /cancel — forbidden (neither tenant nor landlord)", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app)
      .post("/cancel")
      .set("x-user-id", randomUUID())
      .send({ bookingId: id, cancelledBy: "other" });
    expect(res.status).toBe(403);
  });

  it("POST /cancel — already cancelled → 409", async () => {
    const id = randomUUID();
    const row = baseRowStatic(id, listingId, tenantId, landlordId, "cancelled", new Date(start), new Date(end), 0);
    bookings.set(id, row);
    const res = await request(app).post("/cancel").set("x-user-id", tenantId).send({ bookingId: id });
    expect(res.status).toBe(409);
  });

  it("POST /cancel — success as tenant", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).post("/cancel").set("x-user-id", tenantId).send({ bookingId: id });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("POST /cancel — landlord forbidden (tenant-only cancel)", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).post("/cancel").set("x-user-id", landlordId).send({ bookingId: id });
    expect(res.status).toBe(403);
  });

  it("POST /confirm — missing bookingId → 400", async () => {
    const res = await request(app).post("/confirm").set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("POST /confirm — not found → 404", async () => {
    const res = await request(app).post("/confirm").set("x-user-id", tenantId).send({ bookingId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it("POST /confirm — invalid status → 409", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "confirmed", new Date(start), new Date(end), 0),
    );
    const res = await request(app).post("/confirm").set("x-user-id", tenantId).send({ bookingId: id });
    expect(res.status).toBe(409);
  });

  it("POST /confirm — success (tenant confirms ACCEPTED booking)", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(
        id,
        listingId,
        tenantId,
        landlordId,
        "pending_confirmation",
        new Date(start),
        new Date(end),
        0,
      ),
    );
    const res = await request(app).post("/confirm").set("x-user-id", tenantId).send({ bookingId: id });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(kafkaSend).toHaveBeenCalled();
  });

  it("POST /search-history — 201 and GET /search-history/list", async () => {
    const postRes = await request(app)
      .post("/search-history")
      .set("x-user-id", tenantId)
      .send({ query: "studio", minPriceCents: 100 });
    expect(postRes.status).toBe(201);
    const listRes = await request(app).get("/search-history/list").set("x-user-id", tenantId);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);
    expect(listRes.body.items.length).toBeGreaterThan(0);
  });

  it("POST /watchlist/add — missing listingId → 400", async () => {
    const res = await request(app).post("/watchlist/add").set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("POST /watchlist/add — 201 and GET /watchlist/list", async () => {
    const add = await request(app)
      .post("/watchlist/add")
      .set("x-user-id", tenantId)
      .send({ listingId, source: "test" });
    expect(add.status).toBe(201);
    expect(typeof add.body.watch_count).toBe("number");
    expect(add.body.listing_id).toBe(listingId);
    const list = await request(app).get("/watchlist/list").set("x-user-id", tenantId);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
  });

  it("POST /watchlist/remove — missing listingId → 400", async () => {
    const res = await request(app).post("/watchlist/remove").set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("POST /watchlist/remove — success", async () => {
    await request(app).post("/watchlist/add").set("x-user-id", tenantId).send({ listingId });
    const res = await request(app).post("/watchlist/remove").set("x-user-id", tenantId).send({ listingId });
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(typeof res.body.watch_count).toBe("number");
    expect(res.body.listing_id).toBe(listingId);
  });

  it("GET /bookings/mine?peer_review_eligible=1 — returns approved, confirmed, completed; excludes cancelled/expired", async () => {
    const completedId = randomUUID();
    const cancelledId = randomUUID();
    const expiredId = randomUUID();
    const acceptedId = randomUUID();
    const confirmedFutureId = randomUUID();
    const startD = new Date(start);
    const endD = new Date(end);
    const futureEnd = new Date(Date.now() + 86400000 * 60);
    bookings.set(
      completedId,
      baseRowStatic(completedId, listingId, tenantId, landlordId, "completed", startD, endD, 0),
    );
    bookings.set(
      cancelledId,
      baseRowStatic(cancelledId, listingId, tenantId, landlordId, "cancelled", startD, endD, 0),
    );
    bookings.set(
      expiredId,
      baseRowStatic(expiredId, listingId, tenantId, landlordId, "expired", startD, endD, 0),
    );
    bookings.set(
      acceptedId,
      baseRowStatic(acceptedId, listingId, tenantId, landlordId, "pending_confirmation", startD, futureEnd, 0),
    );
    bookings.set(
      confirmedFutureId,
      baseRowStatic(confirmedFutureId, listingId, tenantId, landlordId, "confirmed", startD, futureEnd, 0),
    );
    prismaMock.booking.findMany.mockImplementationOnce(
      async ({ where }: { where?: { OR?: Array<Record<string, unknown>>; tenantId?: string } }) => {
        const all = [...bookings.values()];
        const w = where as { OR?: Array<Record<string, unknown>> };
        if (!w?.OR) {
          return all.filter((b) => b.tenantId === w?.tenantId);
        }
        return all.filter((b) =>
          w.OR!.some((c) => {
            const st = String(c.status);
            if ("tenantId" in c && c.tenantId === tenantId && st === "completed") {
              if ((c as { tenantArchivedAt?: unknown }).tenantArchivedAt === null && (b as { tenantArchivedAt?: Date | null }).tenantArchivedAt) {
                return false;
              }
              return b.tenantId === tenantId && b.status === "completed";
            }
            if ("landlordId" in c && c.landlordId === tenantId && st === "completed") {
              return b.landlordId === tenantId && b.status === "completed";
            }
            if (st === "pending_confirmation") {
              if ("tenantId" in c && c.tenantId === tenantId) {
                if ((c as { tenantArchivedAt?: unknown }).tenantArchivedAt === null && (b as { tenantArchivedAt?: Date | null }).tenantArchivedAt) {
                  return false;
                }
                return b.tenantId === tenantId && b.status === "pending_confirmation";
              }
              if ("landlordId" in c && c.landlordId === tenantId) {
                return b.landlordId === tenantId && b.status === "pending_confirmation";
              }
            }
            if (st === "confirmed") {
              if ("tenantId" in c && c.tenantId === tenantId) {
                if ((c as { tenantArchivedAt?: unknown }).tenantArchivedAt === null && (b as { tenantArchivedAt?: Date | null }).tenantArchivedAt) {
                  return false;
                }
                return b.tenantId === tenantId && b.status === "confirmed";
              }
              if ("landlordId" in c && c.landlordId === tenantId) {
                return b.landlordId === tenantId && b.status === "confirmed";
              }
            }
            return false;
          }),
        );
      },
    );
    const res = await request(app).get("/bookings/mine?peer_review_eligible=1").set("x-user-id", tenantId);
    expect(res.status).toBe(200);
    const ids = (res.body.bookings as { booking_id: string }[]).map((b) => b.booking_id);
    expect(ids).toContain(completedId);
    expect(ids).toContain(acceptedId);
    expect(ids).toContain(confirmedFutureId);
    expect(ids).not.toContain(cancelledId);
    expect(ids).not.toContain(expiredId);
  });

  it("POST /bookings/:id/tenant-archive — hides for mine list", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "cancelled", new Date(start), new Date(end), 0),
    );
    const arch = await request(app).post(`/bookings/${id}/tenant-archive`).set("x-user-id", tenantId);
    expect(arch.status).toBe(200);
    expect(arch.body.tenant_archived_at).toBeTruthy();
    const mineDefault = await request(app).get("/bookings/mine").set("x-user-id", tenantId);
    expect(mineDefault.status).toBe(200);
    expect((mineDefault.body.bookings as unknown[]).some((b: { booking_id?: string }) => b.booking_id === id)).toBe(
      false,
    );
    const mineAll = await request(app).get("/bookings/mine?include_archived=1").set("x-user-id", tenantId);
    expect(mineAll.status).toBe(200);
    expect((mineAll.body.bookings as unknown[]).some((b: { booking_id?: string }) => b.booking_id === id)).toBe(true);
  });

  it("GET /watchlist/listing-counts — returns counts map", async () => {
    await request(app).post("/watchlist/add").set("x-user-id", tenantId).send({ listingId });
    const res = await request(app).get(`/watchlist/listing-counts?ids=${encodeURIComponent(listingId)}`);
    expect(res.status).toBe(200);
    expect(res.body.counts?.[listingId]).toBeGreaterThanOrEqual(1);
  });

  it("GET /watchlist/listings/:listingId/count — 200", async () => {
    const res = await request(app).get(`/watchlist/listings/${encodeURIComponent(listingId)}/count`);
    expect(res.status).toBe(200);
    expect(typeof res.body.watch_count).toBe("number");
  });

  it("PATCH /:bookingId — invalid uuid → 400", async () => {
    const res = await request(app).patch("/bad-id").set("x-user-id", tenantId).send({ tenantNotes: "x" });
    expect(res.status).toBe(400);
  });

  it("PATCH /:bookingId — missing tenantNotes key → 400", async () => {
    const id = randomUUID();
    const res = await request(app).patch(`/${id}`).set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("PATCH /:bookingId — tenantNotes wrong type → 400", async () => {
    const id = randomUUID();
    const res = await request(app).patch(`/${id}`).set("x-user-id", tenantId).send({ tenantNotes: 123 });
    expect(res.status).toBe(400);
  });

  it("PATCH /:bookingId — not found → 404", async () => {
    const id = randomUUID();
    const res = await request(app).patch(`/${id}`).set("x-user-id", tenantId).send({ tenantNotes: "ok" });
    expect(res.status).toBe(404);
  });

  it("PATCH /:bookingId — forbidden → 403", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).patch(`/${id}`).set("x-user-id", otherTenant).send({ tenantNotes: "nope" });
    expect(res.status).toBe(403);
  });

  it("PATCH /:bookingId — terminal status → 409", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "completed", new Date(start), new Date(end), 0),
    );
    const res = await request(app).patch(`/${id}`).set("x-user-id", tenantId).send({ tenantNotes: "x" });
    expect(res.status).toBe(409);
  });

  it("PATCH /:bookingId — success", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).patch(`/${id}`).set("x-user-id", tenantId).send({ tenantNotes: "Move-in Friday" });
    expect(res.status).toBe(200);
    expect(res.body.tenantNotes).toBe("Move-in Friday");
  });

  it("GET /bookings/mine — matches tenant_username_snapshot when auth user id differs", async () => {
    const altTenantId = randomUUID();
    const bookingId = randomUUID();
    bookings.set(
      bookingId,
      {
        ...baseRowStatic(bookingId, listingId, altTenantId, landlordId, "confirmed", new Date(start), new Date(end), 0),
        tenantUsernameSnapshot: "tomwang04312_507ab69b2d",
      },
    );

    const res = await request(app)
      .get("/bookings/mine")
      .set("x-user-id", tenantId)
      .set("x-user-username", "tomwang04312_507ab69b2d_a050a5643e");
    expect(res.status).toBe(200);
    const ids = (res.body.bookings as Array<{ booking_id: string }>).map((b) => b.booking_id);
    expect(ids).toContain(bookingId);
  });

  it("GET /bookings/mine — defaults to tenant role and supports explicit landlord role", async () => {
    const tenantBookingId = randomUUID();
    const landlordBookingId = randomUUID();
    bookings.set(
      tenantBookingId,
      baseRowStatic(tenantBookingId, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    bookings.set(
      landlordBookingId,
      baseRowStatic(landlordBookingId, listingId, otherTenant, tenantId, "created", new Date(start), new Date(end), 0),
    );

    const tenantRes = await request(app).get("/bookings/mine").set("x-user-id", tenantId);
    expect(tenantRes.status).toBe(200);
    const tenantIds = (tenantRes.body.bookings as Array<{ booking_id: string }>).map((b) => b.booking_id);
    expect(tenantIds).toContain(tenantBookingId);
    expect(tenantIds).not.toContain(landlordBookingId);

    const landlordRes = await request(app).get("/bookings/mine?role=landlord").set("x-user-id", tenantId);
    expect(landlordRes.status).toBe(200);
    const landlordIds = (landlordRes.body.bookings as Array<{ booking_id: string }>).map((b) => b.booking_id);
    expect(landlordIds).toContain(landlordBookingId);
    expect(landlordIds).not.toContain(tenantBookingId);
  });

  it("GET /bookings/mine?view=active — excludes cancelled/expired and respects limit", async () => {
    const activeId = randomUUID();
    const cancelledId = randomUUID();
    const expiredId = randomUUID();
    const futureEnd = new Date(Date.now() + 86400000 * 60);
    const startD = new Date(start);
    bookings.set(
      activeId,
      baseRowStatic(activeId, listingId, tenantId, landlordId, "confirmed", startD, futureEnd, 0),
    );
    bookings.set(
      cancelledId,
      baseRowStatic(cancelledId, listingId, tenantId, landlordId, "cancelled", startD, futureEnd, 0),
    );
    bookings.set(
      expiredId,
      baseRowStatic(expiredId, listingId, tenantId, landlordId, "expired", startD, futureEnd, 0),
    );

    const res = await request(app)
      .get("/bookings/mine?role=tenant&view=active&limit=3")
      .set("x-user-id", tenantId);
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("active");
    const ids = (res.body.bookings as { booking_id: string }[]).map((b) => b.booking_id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(cancelledId);
    expect(ids).not.toContain(expiredId);
    expect(ids.length).toBeLessThanOrEqual(3);
  });

  it("GET /bookings/mine?view=past — includes cancelled and expired", async () => {
    const activeId = randomUUID();
    const cancelledId = randomUUID();
    const futureEnd = new Date(Date.now() + 86400000 * 60);
    const startD = new Date(start);
    bookings.set(
      activeId,
      baseRowStatic(activeId, listingId, tenantId, landlordId, "confirmed", startD, futureEnd, 0),
    );
    bookings.set(
      cancelledId,
      baseRowStatic(cancelledId, listingId, tenantId, landlordId, "cancelled", startD, futureEnd, 0),
    );

    const res = await request(app)
      .get("/bookings/mine?role=tenant&view=past")
      .set("x-user-id", tenantId);
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("past");
    const ids = (res.body.bookings as { booking_id: string }[]).map((b) => b.booking_id);
    expect(ids).toContain(cancelledId);
    expect(ids).not.toContain(activeId);
  });

  it("GET /bookings/mine?include_hidden=1 — returns tenant-archived rows", async () => {
    const hiddenId = randomUUID();
    const row = baseRowStatic(
      hiddenId,
      listingId,
      tenantId,
      landlordId,
      "cancelled",
      new Date(start),
      new Date(end),
      0,
    );
    bookings.set(hiddenId, { ...row, tenantArchivedAt: new Date() });

    const hiddenRes = await request(app)
      .get("/bookings/mine?role=tenant&view=all&include_hidden=1")
      .set("x-user-id", tenantId);
    expect(hiddenRes.status).toBe(200);
    const hiddenIds = (hiddenRes.body.bookings as { booking_id: string }[]).map((b) => b.booking_id);
    expect(hiddenIds).toContain(hiddenId);

    const defaultRes = await request(app).get("/bookings/mine?role=tenant&view=all").set("x-user-id", tenantId);
    const defaultIds = (defaultRes.body.bookings as { booking_id: string }[]).map((b) => b.booking_id);
    expect(defaultIds).not.toContain(hiddenId);
  });

  it("GET /mine alias — defaults to tenant role and supports explicit landlord role", async () => {
    const tenantBookingId = randomUUID();
    const landlordBookingId = randomUUID();
    bookings.set(
      tenantBookingId,
      baseRowStatic(tenantBookingId, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    bookings.set(
      landlordBookingId,
      baseRowStatic(landlordBookingId, listingId, otherTenant, tenantId, "created", new Date(start), new Date(end), 0),
    );

    const tenantRes = await request(app).get("/mine").set("x-user-id", tenantId);
    expect(tenantRes.status).toBe(200);
    expect(tenantRes.body.role).toBe("tenant");
    const tenantIds = (tenantRes.body.bookings as Array<{ booking_id: string }>).map((b) => b.booking_id);
    expect(tenantIds).toContain(tenantBookingId);
    expect(tenantIds).not.toContain(landlordBookingId);

    const landlordRes = await request(app).get("/mine?role=landlord").set("x-user-id", tenantId);
    expect(landlordRes.status).toBe(200);
    expect(landlordRes.body.role).toBe("landlord");
    const landlordIds = (landlordRes.body.bookings as Array<{ booking_id: string }>).map((b) => b.booking_id);
    expect(landlordIds).toContain(landlordBookingId);
    expect(landlordIds).not.toContain(tenantBookingId);
  });

  it("POST /create — prisma throws → 500", async () => {
    prismaMock.booking.create.mockRejectedValueOnce(new Error("db"));
    const res = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId, startDate: start, endDate: end });
    expect(res.status).toBe(500);
  });
});

function baseRowStatic(
  id: string,
  listingIdArg: string,
  tenantIdArg: string,
  landlordIdArg: string,
  status: string,
  startDate: Date,
  endDate: Date,
  priceCentsSnapshot: number,
) {
  const now = new Date();
  return {
    id,
    listingId: listingIdArg,
    tenantId: tenantIdArg,
    landlordId: landlordIdArg,
    status,
    startDate,
    endDate,
    priceCentsSnapshot,
    currencyCode: "USD",
    tenantNotes: null as string | null,
    cancellationReason: null as string | null,
    confirmedAt: null as Date | null,
    cancelledAt: null as Date | null,
    completedAt: null as Date | null,
    tenantArchivedAt: null as Date | null,
    createdAt: now,
    updatedAt: now,
  };
}
