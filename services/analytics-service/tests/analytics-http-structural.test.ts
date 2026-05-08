/**
 * Supertest coverage for `createAnalyticsHttpApp()` (mocked DB, Kafka circuit, ingest, hybrid, listing-feel).
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  poolQuery,
  applyIngest,
  analyzeFeel,
  hybridRun,
  breakerFn,
  kafkaConnectivity,
  bookingReadQuery,
  fetchMock,
} = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  applyIngest: vi.fn(),
  analyzeFeel: vi.fn(),
  hybridRun: vi.fn(),
  breakerFn: vi.fn(
    async <T>(fn: () => Promise<T>): Promise<T | null> => (await fn()) as T | null,
  ),
  kafkaConnectivity: vi.fn(),
  bookingReadQuery: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: { query: (...a: unknown[]) => poolQuery(...a) },
}));

vi.mock("../src/booking-read-pool.js", () => ({
  bookingReadPool: { query: (...a: unknown[]) => bookingReadQuery(...a) },
}));

vi.mock("../src/listing-metrics-projection.js", () => ({
  applyListingCreatedForAnalytics: (...a: unknown[]) => applyIngest(...a),
}));

vi.mock("../src/ollama.js", () => ({
  analyzeListingFeelText: (...a: unknown[]) => analyzeFeel(...a),
}));

vi.mock("../src/lib/hybrid-search.js", () => ({
  runHybridSearch: (...a: unknown[]) => hybridRun(...a),
}));

vi.mock("../src/circuitBreaker.js", () => ({
  withCircuitBreaker: (fn: () => Promise<unknown>) => breakerFn(fn),
}));

vi.mock("@common/utils/kafka", () => ({
  checkKafkaConnectivity: () => kafkaConnectivity(),
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

const { createAnalyticsHttpApp } = await import("../src/http-server.js");

const userId = randomUUID();
const eventId = randomUUID();

describe("createAnalyticsHttpApp (structural)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete process.env.KAFKA_BROKER;
    delete process.env.ANALYTICS_HEALTHZ_REQUIRE_KAFKA;
    delete process.env.ANALYTICS_SYNC_MODE;
    delete process.env.ANALYTICS_INTERNAL_INGEST_TOKEN;
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [{}] });
    applyIngest.mockReset();
    applyIngest.mockResolvedValue(true);
    analyzeFeel.mockReset();
    analyzeFeel.mockResolvedValue({
      analysis_text: "- a\n- b",
      model_used: "unit",
      quality_score: 0.7,
    });
    hybridRun.mockReset();
    hybridRun.mockResolvedValue([
      {
        listing_id: eventId,
        title: "t",
        description: "d",
        score: 0.9,
        vector_score: 0.8,
        keyword_score: 0.7,
        recency_score: 0.6,
      },
    ]);
    breakerFn.mockReset();
    breakerFn.mockImplementation(
      async <T>(fn: () => Promise<T>) => (await fn()) as T | null,
    );
    kafkaConnectivity.mockReset();
    kafkaConnectivity.mockResolvedValue(true);
    bookingReadQuery.mockReset();
    bookingReadQuery.mockResolvedValue({ rows: [{ query: "q" }] });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.KAFKA_BROKER;
    delete process.env.ANALYTICS_HEALTHZ_REQUIRE_KAFKA;
    delete process.env.ANALYTICS_SYNC_MODE;
    delete process.env.ANALYTICS_INTERNAL_INGEST_TOKEN;
    delete process.env.ANALYTICS_LISTING_FEEL_EXPOSE_ERRORS;
    delete process.env.ANALYTICS_LISTING_FEEL_NO_DEGRADED_MASK;
    delete process.env.OLLAMA_BASE_URL;
    vi.unstubAllGlobals();
  });

  it("GET /health/ollama — 503 when OLLAMA_BASE_URL unset", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).get("/health/ollama").expect(503);
  });

  it("GET /health/ollama — 200 when /api/tags succeeds", async () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    const app = createAnalyticsHttpApp();
    const res = await request(app).get("/health/ollama").expect(200);
    expect(res.body).toMatchObject({ ok: true, ollama: "reachable" });
  });

  it("GET /healthz — DB only when Kafka not configured", async () => {
    const app = createAnalyticsHttpApp();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body).toMatchObject({ ok: true, db: "connected" });
    expect(res.body.kafka).toBeUndefined();
  });

  it("GET /healthz — Kafka connected", async () => {
    process.env.KAFKA_BROKER = "localhost:9092";
    const app = createAnalyticsHttpApp();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body.kafka).toBe("connected");
  });

  it("GET /healthz — Kafka disconnected via circuit", async () => {
    process.env.KAFKA_BROKER = "localhost:9092";
    breakerFn.mockImplementation(async () => null);
    const app = createAnalyticsHttpApp();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body.kafka).toBe("disconnected");
  });

  it("GET /healthz — 503 when strict Kafka required but down", async () => {
    process.env.KAFKA_BROKER = "localhost:9092";
    process.env.ANALYTICS_HEALTHZ_REQUIRE_KAFKA = "1";
    breakerFn.mockImplementation(async () => null);
    const app = createAnalyticsHttpApp();
    await request(app).get("/healthz").expect(503);
  });

  it("GET /healthz — DB disconnected", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const app = createAnalyticsHttpApp();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body.db).toBe("disconnected");
  });

  it("GET /readyz — 200", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).get("/readyz").expect(200);
  });

  it("GET /readyz — 503 when DB down", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const app = createAnalyticsHttpApp();
    await request(app).get("/readyz").expect(503);
  });

  it("GET /metrics", async () => {
    const app = createAnalyticsHttpApp();
    const res = await request(app).get("/metrics").expect(200);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("POST /internal/ingest/listing-created — 404 when sync mode off", async () => {
    const app = createAnalyticsHttpApp();
    await request(app)
      .post("/internal/ingest/listing-created")
      .send({ event_id: eventId, listed_at_day: "2026-01-01" })
      .expect(404);
  });

  it("POST /internal/ingest/listing-created — 403 bad token", async () => {
    process.env.ANALYTICS_SYNC_MODE = "1";
    process.env.ANALYTICS_INTERNAL_INGEST_TOKEN = "secret";
    const app = createAnalyticsHttpApp();
    await request(app)
      .post("/internal/ingest/listing-created")
      .set("x-internal-ingest-token", "wrong")
      .send({ event_id: eventId, listed_at_day: "2026-01-02" })
      .expect(403);
  });

  it("POST /internal/ingest/listing-created — 400 invalid body", async () => {
    process.env.ANALYTICS_SYNC_MODE = "1";
    const app = createAnalyticsHttpApp();
    await request(app)
      .post("/internal/ingest/listing-created")
      .send({ event_id: "nope", listed_at_day: "2026-01-03" })
      .expect(400);
  });

  it("POST /internal/ingest/listing-created — 204", async () => {
    process.env.ANALYTICS_SYNC_MODE = "1";
    const app = createAnalyticsHttpApp();
    await request(app)
      .post("/internal/ingest/listing-created")
      .send({ event_id: eventId, listed_at_day: "2026-04-04" })
      .expect(204);
    expect(applyIngest).toHaveBeenCalled();
  });

  it("POST /internal/ingest/listing-created — 500", async () => {
    process.env.ANALYTICS_SYNC_MODE = "1";
    applyIngest.mockRejectedValueOnce(new Error("proj"));
    const app = createAnalyticsHttpApp();
    await request(app)
      .post("/internal/ingest/listing-created")
      .send({ event_id: eventId, listed_at_day: "2026-05-05" })
      .expect(500);
  });

  it("GET /daily-metrics — 400 without date", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).get("/daily-metrics").expect(400);
  });

  it("GET /daily-metrics — zeros when no row", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const app = createAnalyticsHttpApp();
    const res = await request(app)
      .get("/daily-metrics")
      .query({ date: "2026-06-01" })
      .expect(200);
    expect(res.body.new_users).toBe(0);
  });

  it("GET /daily-metrics — returns row", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          date: "2026-06-02",
          new_users: 1,
          new_listings: 2,
          new_bookings: 3,
          completed_bookings: 4,
          messages_sent: 7,
          listings_flagged: 8,
        },
      ],
    });
    const app = createAnalyticsHttpApp();
    await request(app)
      .get("/daily-metrics")
      .query({ date: "2026-06-02" })
      .expect(200);
  });

  it("GET /daily-metrics — 500 on DB error", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const app = createAnalyticsHttpApp();
    await request(app)
      .get("/daily-metrics")
      .query({ date: "2026-06-03" })
      .expect(500);
  });

  it("GET /insights/watchlist/:userId — 400, 200, 500", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).get("/insights/watchlist/%0A").expect(400);
    poolQuery.mockResolvedValueOnce({ rows: [{ a: 2, r: 1 }] });
    await request(app).get(`/insights/watchlist/${userId}`).expect(200);
    poolQuery.mockRejectedValueOnce(new Error("db"));
    await request(app).get(`/insights/watchlist/${userId}`).expect(500);
  });

  it("GET /insights/search-summary/:userId — 403 and 200", async () => {
    const app = createAnalyticsHttpApp();
    await request(app)
      .get(`/insights/search-summary/${userId}`)
      .set("x-user-id", randomUUID())
      .expect(403);
    const res = await request(app)
      .get(`/insights/search-summary/${userId}`)
      .set("x-user-id", userId)
      .expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("GET /insights/search-summary/:userId — 500", async () => {
    bookingReadQuery.mockRejectedValueOnce(new Error("read"));
    const app = createAnalyticsHttpApp();
    await request(app)
      .get(`/insights/search-summary/${userId}`)
      .set("x-user-id", userId)
      .expect(500);
  });

  it("GET POST-only insight paths — 405 JSON + Allow: POST (not Cannot GET)", async () => {
    const app = createAnalyticsHttpApp();
    const feel = await request(app).get("/insights/listing-feel").expect(405);
    expect(feel.headers.allow).toBe("POST");
    expect(feel.body).toMatchObject({
      error: "method_not_allowed",
      code: "POST_REQUIRED",
      ui: "/analytics",
    });
    const hybrid = await request(app).get("/insights/hybrid-search").expect(405);
    expect(hybrid.headers.allow).toBe("POST");
    await request(app).get(`/insights/listing/${eventId}/analyze`).expect(405);
  });

  it("POST /insights/listing-feel — 400, 200, 500", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).post("/insights/listing-feel").send({}).expect(400);
    await request(app)
      .post("/insights/listing-feel")
      .send({ title: "T", description: "D", price_cents: 100 })
      .expect(200);
    analyzeFeel.mockRejectedValueOnce(new Error("x"));
    const degraded = await request(app)
      .post("/insights/listing-feel")
      .send({ title: "T2", price_cents: 200 })
      .expect(200);
    expect(degraded.body).toMatchObject({
      degraded: true,
      model_used: "error-degraded",
      quality_score: expect.any(Number),
      listing_feel_status: "degraded",
      failure_code: expect.any(String),
    });
    expect(String(degraded.body.analysis_text || "").length).toBeGreaterThan(20);
  });

  it("POST /insights/listing-feel — 502 generation_failed when ANALYTICS_LISTING_FEEL_EXPOSE_ERRORS=1", async () => {
    process.env.ANALYTICS_LISTING_FEEL_EXPOSE_ERRORS = "1";
    const app = createAnalyticsHttpApp();
    analyzeFeel.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app)
      .post("/insights/listing-feel")
      .send({ title: "T2", price_cents: 200 })
      .expect(502);
    expect(res.body).toMatchObject({
      error: "generation_failed",
      failure_code: expect.any(String),
      detail: expect.stringContaining("boom"),
    });
  });

  it("POST /insights/listing-feel-minimal — 404 when endpoint disabled", async () => {
    delete process.env.ANALYTICS_LISTING_FEEL_MINIMAL_ENDPOINT;
    const app = createAnalyticsHttpApp();
    await request(app).post("/insights/listing-feel-minimal").send({ prompt: "hi" }).expect(404);
  });

  it("POST /insights/listing-feel-minimal — 502 when Ollama returns non-JSON", async () => {
    process.env.ANALYTICS_LISTING_FEEL_MINIMAL_ENDPOINT = "1";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const app = createAnalyticsHttpApp();
    await request(app).post("/insights/listing-feel-minimal").send({ prompt: "Say hello" }).expect(502);
  });

  it("POST /insights/listing/:listingId/analyze — 400 invalid id", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).post("/insights/listing/not-a-uuid/analyze").send({}).expect(400);
  });

  it("POST /insights/listing/:listingId/analyze — 404 when listing missing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const app = createAnalyticsHttpApp();
    await request(app).post(`/insights/listing/${eventId}/analyze`).send({}).expect(404);
  });

  it("POST /insights/listing/:listingId/analyze — 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "T",
          description: "D",
          price_cents: 50000,
          landlord_id: userId,
          amenities: ["wifi"],
          lease_terms: { lease_length_months: 12 },
          availability_status: "active",
        }),
        { status: 200 },
      ),
    );
    analyzeFeel.mockResolvedValueOnce({
      analysis_text: "ok",
      model_used: "unit+v2",
      quality_score: 0.5,
      intelligence_json: JSON.stringify({ intelligence: { verdict: "fine" }, meta: {} }),
    });
    const app = createAnalyticsHttpApp();
    const res = await request(app)
      .post(`/insights/listing/${eventId}/analyze`)
      .send({ audience: "renter" })
      .expect(200);
    expect(res.body.listing_id).toBe(eventId);
    expect(res.body._meta.fallback_used).toBe(false);
    expect(analyzeFeel).toHaveBeenCalled();
  });

  it("POST /listing/:listingId/analyze — alias returns 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "T",
          description: "D",
          price_cents: 100,
          landlord_id: userId,
        }),
        { status: 200 },
      ),
    );
    analyzeFeel.mockResolvedValueOnce({
      analysis_text: "ok",
      model_used: "unit+v2",
      quality_score: 0.5,
    });
    const app = createAnalyticsHttpApp();
    await request(app).post(`/listing/${eventId}/analyze`).send({}).expect(200);
  });

  it("POST /insights/hybrid-search — 400, 200, 500", async () => {
    const app = createAnalyticsHttpApp();
    await request(app).post("/insights/hybrid-search").send({}).expect(400);
    await request(app)
      .post("/insights/hybrid-search")
      .send({ query: "apt", limit: 2 })
      .expect(200);
    hybridRun.mockRejectedValueOnce(new Error("h"));
    await request(app)
      .post("/insights/hybrid-search")
      .send({ query: "x", limit: 1 })
      .expect(500);
  });
});
