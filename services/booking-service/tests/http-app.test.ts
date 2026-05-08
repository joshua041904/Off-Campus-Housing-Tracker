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
          const next = { ...row, tenantNotes: data.tenantNotes ?? null };
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
    },
    searchHistory: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = randomUUID();
        const row = { id, ...data, createdAt: new Date() };
        searchHistoryRows.push(row as never);
        return { ...row };
      }),
      findMany: vi.fn(
        async ({ where, take }: { where: { userId: string }; take: number }) =>
          searchHistoryRows.filter((r: { userId: string }) => r.userId === where.userId).slice(0, take),
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
    },
  };

  return { bookings, searchHistoryRows, watchByComposite, prismaMock };
});

vi.mock("../src/lib/prisma.js", () => ({
  prisma: prismaMock,
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
        new Response(JSON.stringify({ landlord_id: landlordId, price_cents: 9900 }), {
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
    expect(kafkaSend).toHaveBeenCalled();
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
      .send({
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: "2030-07-01",
        message: "Tour?",
      });
    expect(res.status).toBe(201);
    expect(res.body.booking_id).toBeTruthy();
    expect(res.body.landlord_id).toBe(landlordId);
    expect(kafkaSend).toHaveBeenCalled();
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

  it("POST /cancel — success as landlord", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).post("/cancel").set("x-user-id", landlordId).send({ bookingId: id });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
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
    const res = await request(app).post("/confirm").set("x-user-id", landlordId).send({ bookingId: id });
    expect(res.status).toBe(409);
  });

  it("POST /confirm — success", async () => {
    const id = randomUUID();
    bookings.set(
      id,
      baseRowStatic(id, listingId, tenantId, landlordId, "created", new Date(start), new Date(end), 0),
    );
    const res = await request(app).post("/confirm").set("x-user-id", landlordId).send({ bookingId: id });
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
    createdAt: now,
    updatedAt: now,
  };
}
