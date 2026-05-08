/**
 * Phase H.3: Supertest coverage for `createListingsHttpApp()` (mocked pool, Kafka, analytics, OTEL).
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery, publishCreate, syncAnalytics } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  publishCreate: vi.fn(),
  syncAnalytics: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
  },
}));

vi.mock("../src/listing-kafka.js", () => ({
  publishListingEventForCreateResponse: (
    ...args: unknown[]
  ) => publishCreate(...args),
}));

vi.mock("../src/analytics-sync.js", () => ({
  syncListingCreatedToAnalytics: (...args: unknown[]) =>
    syncAnalytics(...args),
}));

vi.mock("@common/utils/otel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils/otel")>();
  return {
    ...actual,
    tracingMiddleware: (_req: unknown, _res: unknown, next: () => void) =>
      next(),
    mountDebugTraceHeaders: () => {},
    inferNetProtoForSpan: () => "http",
  };
});

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    createHttpConcurrencyGuard: () =>
      (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

const userId = randomUUID();
const listingId = randomUUID();

function baseListingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: listingId,
    user_id: userId,
    title: "Cozy sublet",
    description: "Near campus",
    price_cents: 120000,
    amenities: ["wifi"],
    smoke_free: true,
    pet_friendly: false,
    furnished: true,
    status: "active",
    created_at: new Date("2026-02-01T12:00:00.000Z"),
    updated_at: new Date("2026-02-01T12:00:00.000Z"),
    effective_from: "2026-01-01",
    effective_until: null,
    lease_length_months: null,
    listed_at: "2026-02-02",
    latitude: "40.7",
    longitude: "-74.0",
    images_json: [] as unknown[],
    ...overrides,
  };
}

function routePool(
  sql: string,
  params?: unknown[],
): Promise<{ rows: unknown[]; rowCount?: number }> {
  const norm = sql.replace(/\s+/g, " ").trim();
  if (norm === "SELECT 1") {
    return Promise.resolve({ rows: [{ "?column?": 1 }], rowCount: 1 });
  }
  if (norm.includes("INSERT INTO listings.listings") && params?.length) {
    const p = params as unknown[];
    const uid = p[0];
    const title = p[1];
    const description = p[2];
    const price_cents = p[3];
    const amenitiesJson = p[4];
    const smoke_free = p[5];
    const pet_friendly = p[6];
    const furnished = p[7];
    const lat = p[10];
    const lng = p[11];
    return Promise.resolve({
      rows: [
        baseListingRow({
          id: randomUUID(),
          user_id: uid,
          title,
          description,
          price_cents,
          amenities: JSON.parse(String(amenitiesJson)) as string[],
          smoke_free,
          pet_friendly,
          furnished,
          latitude: lat,
          longitude: lng,
        }),
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("WHERE l.id = $1::uuid") && norm.includes("deleted_at IS NULL")) {
    return Promise.resolve({
      rows: [
        baseListingRow({
          images_json: ["https://cdn.example/a.jpg"],
          lease_length_months: 12,
        }),
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("FROM listings.listings")) {
    return Promise.resolve({
      rows: [
        baseListingRow({ id: listingId }),
        baseListingRow({ id: listingId }),
        baseListingRow({
          id: randomUUID(),
          amenities: { a: "gym", b: "elevator" },
          listed_at: null,
          latitude: "nan",
          longitude: null,
        }),
      ],
      rowCount: 3,
    });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}

const { createListingsHttpApp } = await import("../src/http-server.js");

describe("createListingsHttpApp", () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete process.env.LISTINGS_HTTP_TIMING;
    delete process.env.LISTINGS_HTTP_TIMING_MIN_MS;
    delete process.env.LISTINGS_HTTP_POOL_STATS_MS;
    delete process.env.LISTINGS_HTTP_SEARCH_DB_MIN_MS;
    poolQuery.mockReset();
    poolQuery.mockImplementation((sql: string, params?: unknown[]) =>
      routePool(sql, params),
    );
    publishCreate.mockReset();
    publishCreate.mockResolvedValue(undefined);
    syncAnalytics.mockReset();
    syncAnalytics.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: randomUUID(), ok: true }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    delete process.env.LISTINGS_HTTP_TIMING;
    delete process.env.LISTINGS_HTTP_POOL_STATS_MS;
    delete process.env.LISTINGS_HTTP_SEARCH_DB_MIN_MS;
    vi.unstubAllGlobals();
  });

  it("GET /healthz — DB connected", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body).toEqual({ ok: true, db: "connected" });
  });

  it("GET /health — DB disconnected", async () => {
    poolQuery.mockRejectedValueOnce(new Error("econnrefused"));
    const app = createListingsHttpApp();
    const res = await request(app).get("/health").expect(200);
    expect(res.body.db).toBe("disconnected");
  });

  it("GET /metrics returns metrics body", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get("/metrics").expect(200);
    expect(res.headers["content-type"]).toMatch(/openmetrics|text/);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("enables diagnostics + pool stats interval when env set", async () => {
    process.env.LISTINGS_HTTP_TIMING = "1";
    process.env.LISTINGS_HTTP_TIMING_MIN_MS = "0";
    process.env.LISTINGS_HTTP_POOL_STATS_MS = "10";
    const app = createListingsHttpApp();
    await request(app).get("/healthz").expect(200);
  });

  it("GET / — search returns deduped items", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get("/").expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /search — q + filters + new_within + sort", async () => {
    const app = createListingsHttpApp();
    const res = await request(app)
      .get("/search")
      .query({
        q: "loft",
        min_price: 100,
        max_price: 999999,
        smoke_free: "true",
        pet_friendly: "1",
        furnished: "yes",
        new_within_days: 30,
        sort: "price_asc",
        limit: 10,
        offset: 0,
        dishwasher: "true",
        in_unit_laundry: "true",
      })
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /search — logs DB timing when LISTINGS_HTTP_TIMING=1", async () => {
    process.env.LISTINGS_HTTP_TIMING = "1";
    process.env.LISTINGS_HTTP_SEARCH_DB_MIN_MS = "0";
    const app = createListingsHttpApp();
    await request(app).get("/search?q=test").expect(200);
  });

  it("GET /search — 500 on pool error", async () => {
    poolQuery.mockRejectedValueOnce(new Error("search boom"));
    const app = createListingsHttpApp();
    await request(app).get("/search").expect(500);
  });

  it("GET /listings/:id — 400 invalid id", async () => {
    const app = createListingsHttpApp();
    await request(app).get("/listings/not-a-uuid").expect(400);
  });

  it("GET /listings/:id — 404", async () => {
    poolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WHERE l.id = $1::uuid") && norm.includes("deleted_at IS NULL")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return routePool(sql, params);
    });
    const app = createListingsHttpApp();
    await request(app).get(`/listings/${listingId}`).expect(404);
  });

  it("GET /listings/:id — 200 marketplace detail shape", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get(`/listings/${listingId}`).expect(200);
    expect(res.body.id).toBe(listingId);
    expect(res.body.landlord_id).toBe(userId);
    expect(res.body.price).toBe(1200);
    expect(res.body.images).toEqual(["https://cdn.example/a.jpg"]);
    expect(res.body.lease_terms.lease_length_months).toBe(12);
  });

  it("GET /:uuid — 200 alias", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get(`/${listingId}`).expect(200);
    expect(res.body.id).toBe(listingId);
    expect(res.body.price).toBe(1200);
  });

  it("GET /not-a-uuid-path — 404", async () => {
    const app = createListingsHttpApp();
    await request(app).get("/not-a-uuid").expect(404);
  });

  it("POST /listings/:id/save — 401 without user", async () => {
    const app = createListingsHttpApp();
    await request(app).post(`/listings/${listingId}/save`).expect(401);
  });

  it("POST /listings/:id/save — 201 proxies booking", async () => {
    const app = createListingsHttpApp();
    const res = await request(app)
      .post(`/listings/${listingId}/save`)
      .set("x-user-id", userId)
      .expect(201);
    expect(res.body.saved).toBe(true);
    expect(res.body.listing_id).toBe(listingId);
  });

  it("GET /listings/:id — 500 on pool error", async () => {
    poolQuery.mockRejectedValueOnce(new Error("get boom"));
    const app = createListingsHttpApp();
    await request(app).get(`/listings/${listingId}`).expect(500);
  });

  const validCreateBody = () => ({
    title: "Room for rent",
    description: "Quiet building",
    price_cents: 50000,
    amenities: ["wifi"],
    smoke_free: false,
    pet_friendly: true,
    furnished: false,
    effective_from: "2026-01-15",
    effective_until: "",
    latitude: 40.7128,
    longitude: -74.006,
  });

  it("POST /create — 401 without x-user-id", async () => {
    const app = createListingsHttpApp();
    await request(app).post("/create").send(validCreateBody()).expect(401);
  });

  it("POST /create — 400 validation", async () => {
    const app = createListingsHttpApp();
    await request(app)
      .post("/create")
      .set("x-user-id", userId)
      .send({ ...validCreateBody(), title: "" })
      .expect(400);
  });

  it("POST /create — 201 and calls analytics + kafka", async () => {
    const app = createListingsHttpApp();
    const res = await request(app)
      .post("/create")
      .set("x-user-id", userId)
      .send(validCreateBody())
      .expect(201);
    expect(res.body.title).toBe("Room for rent");
    expect(syncAnalytics).toHaveBeenCalled();
    expect(publishCreate).toHaveBeenCalled();
  });

  it("POST /create — 500 when analytics sync fails", async () => {
    syncAnalytics.mockRejectedValueOnce(new Error("analytics down"));
    const app = createListingsHttpApp();
    await request(app)
      .post("/create")
      .set("x-user-id", userId)
      .send(validCreateBody())
      .expect(500);
  });

  it("POST /create — 503 when kafka publish fails", async () => {
    syncAnalytics.mockResolvedValue(undefined);
    publishCreate.mockRejectedValueOnce(new Error("kafka down"));
    const app = createListingsHttpApp();
    await request(app)
      .post("/create")
      .set("x-user-id", userId)
      .send(validCreateBody())
      .expect(503);
  });

  it("POST /create — 500 when insert fails", async () => {
    publishCreate.mockResolvedValue(undefined);
    poolQuery.mockRejectedValueOnce(new Error("insert failed"));
    const app = createListingsHttpApp();
    await request(app)
      .post("/create")
      .set("x-user-id", userId)
      .send(validCreateBody())
      .expect(500);
  });
});
