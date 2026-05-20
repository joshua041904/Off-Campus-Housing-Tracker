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
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        const s = sql.replace(/\s+/g, " ").trim();
        if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        return poolQuery(sql, params);
      },
      release: vi.fn(),
    }),
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

vi.mock("../src/community-kafka.js", () => ({
  publishCommunityEvent: vi.fn().mockResolvedValue(undefined),
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
    username_display: "Pat Host",
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
    media_items_json: [] as unknown[],
    ...overrides,
  };
}

function routePool(
  sql: string,
  params?: unknown[],
): Promise<{ rows: unknown[]; rowCount?: number }> {
  const norm = sql.replace(/\s+/g, " ").trim();
  if (norm.includes("COUNT(*)::int AS image_count") && norm.includes("FROM listings.listing_media")) {
    return Promise.resolve({ rows: [{ image_count: 1 }], rowCount: 1 });
  }
  if (norm === "SELECT 1") {
    return Promise.resolve({ rows: [{ "?column?": 1 }], rowCount: 1 });
  }
  if (norm.includes("row_to_json(s)::jsonb")) {
    return Promise.resolve({
      rows: [{ snapshot: { id: params?.[0] ?? listingId, title: "Room for rent" } }],
      rowCount: 1,
    });
  }
  if (norm.includes("INSERT INTO listings.listing_revisions")) {
    return Promise.resolve({ rows: [{ id: randomUUID() }], rowCount: 1 });
  }
  if (norm.includes("INSERT INTO listings.listings") && params?.length) {
    const p = params as unknown[];
    const uid = p[0];
    const username_display = p[1];
    const title = p[2];
    const description = p[3];
    const price_cents = p[4];
    const amenitiesJson = p[5];
    const smoke_free = p[6];
    const pet_friendly = p[7];
    const furnished = p[8];
    const lat = p[11];
    const lng = p[12];
    const statusVal = p.length > 25 && p[25] != null ? String(p[25]) : "active";
    return Promise.resolve({
      rows: [
        baseListingRow({
          id: randomUUID(),
          user_id: uid,
          username_display: typeof username_display === "string" && username_display ? username_display : "Pat Host",
          title,
          description,
          price_cents,
          amenities: JSON.parse(String(amenitiesJson)) as string[],
          smoke_free,
          pet_friendly,
          furnished,
          latitude: lat,
          longitude: lng,
          status: statusVal,
        }),
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("SELECT user_id FROM listings.listings") && norm.includes("FOR UPDATE")) {
    return Promise.resolve({
      rows: [{ user_id: userId }],
      rowCount: 1,
    });
  }
  if (
    norm.includes("FROM listings.listing_media") &&
    norm.includes("listing_id = $2::uuid LIMIT 1")
  ) {
    return Promise.resolve({
      rows: [
        {
          id: (params as unknown[])[0],
          url_or_path: "https://cdn.example/del.jpg",
          media_type: "image",
        },
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("WHERE user_id = $1::uuid") && norm.includes("ORDER BY created_at DESC")) {
    return Promise.resolve({
      rows: [baseListingRow({ id: listingId, title: "Mine row", status: "active" })],
      rowCount: 1,
    });
  }
  if (
    norm.includes("SELECT id, user_id, status::text AS status FROM listings.listings") &&
    norm.includes("LIMIT 1")
  ) {
    const p = params as unknown[];
    return Promise.resolve({
      rows: [
        baseListingRow({
          id: p[0],
          user_id: userId,
          status: "paused",
        }),
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("UPDATE listings.listings") && norm.includes("SET status")) {
    const p = params as unknown[];
    return Promise.resolve({
      rows: [{ id: p[0], status: p[1], version: 3 }],
      rowCount: 1,
    });
  }
  if (norm.includes("WHERE l.id = $1::uuid") && norm.includes("deleted_at IS NULL")) {
    const mid = randomUUID();
    return Promise.resolve({
      rows: [
        baseListingRow({
          images_json: ["https://cdn.example/a.jpg"],
          media_items_json: [
            {
              id: mid,
              url_or_path: "https://cdn.example/a.jpg",
              media_type: "image",
              sort_order: 0,
            },
          ],
          lease_length_months: 12,
        }),
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("COALESCE(MAX(sort_order), -1) + 1")) {
    return Promise.resolve({ rows: [{ n: 2 }], rowCount: 1 });
  }
  if (norm.includes("INSERT INTO listings.listing_media") && norm.includes("RETURNING")) {
    return Promise.resolve({
      rows: [
        {
          id: randomUUID(),
          listing_id: params?.[0],
          media_type: params?.[1],
          url_or_path: params?.[2],
          sort_order: params?.[3],
          created_at: new Date().toISOString(),
        },
      ],
      rowCount: 1,
    });
  }
  if (norm.includes("DELETE FROM listings.listing_media WHERE id")) {
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (norm.includes("UPDATE listings.listing_media SET sort_order")) {
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (norm.includes("SELECT id::text FROM listings.listing_media WHERE listing_id")) {
    return Promise.resolve({
      rows: [
        { id: "11111111-1111-4111-8111-111111111111" },
        { id: "22222222-2222-4222-8222-222222222222" },
      ],
      rowCount: 2,
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

  it("GET /search — repeated query is served from cache", async () => {
    const app = createListingsHttpApp();
    await request(app).get("/search?q=cache-me&limit=10").expect(200);
    await request(app).get("/search?q=cache-me&limit=10").expect(200);
    const dbCalls = poolQuery.mock.calls.filter((call) =>
      String(call[0]).includes("FROM listings.listings"),
    );
    expect(dbCalls.length).toBe(1);
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
    await request(app).get("/search?q=force-db-error").expect(500);
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
    expect(res.body.user_id).toBe(userId);
    expect(res.body.landlord_display).toBe("Pat Host");
    expect(res.body.price).toBe(1200);
    expect(res.body.images).toEqual(["https://cdn.example/a.jpg"]);
    expect(res.body.lease_terms.lease_length_months).toBe(12);
  });

  it("GET /listings/:id/meta — returns active booking count", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get(`/listings/${listingId}/meta`).expect(200);
    expect(res.body.listingId).toBe(listingId);
    expect(typeof res.body.activeBookingCount).toBe("number");
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
    images: ["https://cdn.example/listing-cover.jpg"],
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

  it("POST /create — 400 without images", async () => {
    const app = createListingsHttpApp();
    const { images: _i, ...rest } = validCreateBody();
    await request(app).post("/create").set("x-user-id", userId).send(rest).expect(400);
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

  it("GET /mine — 401 without x-user-id", async () => {
    const app = createListingsHttpApp();
    await request(app).get("/mine").expect(401);
  });

  it("GET /mine — 200 returns items", async () => {
    const app = createListingsHttpApp();
    const res = await request(app).get("/mine").set("x-user-id", userId).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH /listings/:id/status — 400 invalid status", async () => {
    const app = createListingsHttpApp();
    await request(app)
      .patch(`/listings/${listingId}/status`)
      .set("x-user-id", userId)
      .send({ status: "flagged" })
      .expect(400);
  });

  it("PATCH /listings/:id/status — 403 when not owner", async () => {
    poolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (
        norm.includes("SELECT id, user_id, status::text AS status FROM listings.listings") &&
        norm.includes("LIMIT 1")
      ) {
        return Promise.resolve({
          rows: [baseListingRow({ user_id: randomUUID(), status: "active" })],
          rowCount: 1,
        });
      }
      return routePool(sql, params);
    });
    const app = createListingsHttpApp();
    await request(app)
      .patch(`/listings/${listingId}/status`)
      .set("x-user-id", userId)
      .send({ status: "paused" })
      .expect(403);
  });

  it("PATCH /listings/:id/status — 400 activating without images", async () => {
    poolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("COUNT(*)::int AS image_count") && norm.includes("FROM listings.listing_media")) {
        return Promise.resolve({ rows: [{ image_count: 0 }], rowCount: 1 });
      }
      if (
        norm.includes("SELECT id, user_id, status::text AS status FROM listings.listings") &&
        norm.includes("LIMIT 1")
      ) {
        return Promise.resolve({
          rows: [baseListingRow({ status: "paused" })],
          rowCount: 1,
        });
      }
      return routePool(sql, params);
    });
    const app = createListingsHttpApp();
    await request(app)
      .patch(`/listings/${listingId}/status`)
      .set("x-user-id", userId)
      .send({ status: "active" })
      .expect(400);
  });

  it("GET /listings/:id/watch-count — 200 proxies booking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ listing_id: listingId, watch_count: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const app = createListingsHttpApp();
    const res = await request(app).get(`/listings/${listingId}/watch-count`).expect(200);
    expect(res.body.watch_count).toBe(3);
  });

  it("PATCH /listings/:id/status — 200 and publishes ListingStatusUpdatedV1", async () => {
    poolQuery.mockImplementation((sql: string, params?: unknown[]) =>
      routePool(sql, params),
    );
    const app = createListingsHttpApp();
    await request(app)
      .patch(`/listings/${listingId}/status`)
      .set("x-user-id", userId)
      .send({ status: "active" })
      .expect(200);
    expect(publishCreate).toHaveBeenCalledWith(
      "ListingStatusUpdatedV1",
      listingId,
      expect.objectContaining({
        listing_id: listingId,
        previous_status: "paused",
        new_status: "active",
      }),
    );
  });

  it("GET /listings/:id — 404 when paused and anonymous", async () => {
    poolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WHERE l.id = $1::uuid") && norm.includes("deleted_at IS NULL")) {
        return Promise.resolve({
          rows: [baseListingRow({ status: "paused", user_id: userId })],
          rowCount: 1,
        });
      }
      return routePool(sql, params);
    });
    const app = createListingsHttpApp();
    await request(app).get(`/listings/${listingId}`).expect(404);
  });

  it("GET /listings/:id — 200 when paused but owner", async () => {
    poolQuery.mockImplementation((sql: string, params?: unknown[]) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("WHERE l.id = $1::uuid") && norm.includes("deleted_at IS NULL")) {
        return Promise.resolve({
          rows: [baseListingRow({ status: "paused", user_id: userId })],
          rowCount: 1,
        });
      }
      return routePool(sql, params);
    });
    const app = createListingsHttpApp();
    const res = await request(app)
      .get(`/listings/${listingId}`)
      .set("x-user-id", userId)
      .expect(200);
    expect(res.body.availability_status).toBe("paused");
  });

  it("POST /listings/:id/media — 201 returns media + listing", async () => {
    const app = createListingsHttpApp();
    const res = await request(app)
      .post(`/listings/${listingId}/media`)
      .set("x-user-id", userId)
      .send({ media_url: "https://cdn.example/new.jpg", media_type: "image" })
      .expect(201);
    expect(res.body.media?.url_or_path).toBe("https://cdn.example/new.jpg");
    expect(res.body.listing?.id).toBeTruthy();
  });

  it("POST /listings/:id/media — 201 accepts OCH signed inline media path", async () => {
    const mid = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const signedPath = `/api/media/public/${mid}?e=9999999999&s=abcdef`;
    const app = createListingsHttpApp();
    const res = await request(app)
      .post(`/listings/${listingId}/media`)
      .set("x-user-id", userId)
      .send({ media_url: signedPath, media_type: "image" })
      .expect(201);
    expect(res.body.media?.url_or_path).toBe(signedPath);
    expect(res.body.listing?.id).toBeTruthy();
  });

  it("DELETE /listings/:id/media/:mid — 200 returns listing", async () => {
    const mid = randomUUID();
    const app = createListingsHttpApp();
    const res = await request(app)
      .delete(`/listings/${listingId}/media/${mid}`)
      .set("x-user-id", userId)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.listing?.id).toBeTruthy();
  });

  it("PATCH /listings/:id/media-order — 200", async () => {
    const app = createListingsHttpApp();
    await request(app)
      .patch(`/listings/${listingId}/media-order`)
      .set("x-user-id", userId)
      .send({
        ordered_media_ids: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      })
      .expect(200);
  });
});
