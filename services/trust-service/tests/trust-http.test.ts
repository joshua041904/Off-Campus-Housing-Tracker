/**
 * Phase H.2: structural HTTP coverage for `http-server.ts` (Supertest + mocked pool).
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
  },
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

const { createTrustHttpApp } = await import("../src/http-server.js");

const reporter = randomUUID();
const listingId = randomUUID();
const targetUser = randomUUID();
const bookingId = randomUUID();
const revieweeId = randomUUID();

function defaultPool(sql: string): Promise<{ rows: unknown[] }> {
  const norm = sql.replace(/\s+/g, " ").trim();
  if (norm === "SELECT 1") {
    return Promise.resolve({ rows: [{ "?column?": 1 }] });
  }
  if (norm.includes("INSERT INTO trust.listing_flags")) {
    return Promise.resolve({ rows: [{ id: "flag-1", status: "open" }] });
  }
  if (norm.includes("INSERT INTO trust.user_flags")) {
    return Promise.resolve({ rows: [{ id: "uf-1", status: "open" }] });
  }
  if (norm.includes("INSERT INTO trust.reviews")) {
    return Promise.resolve({ rows: [{ id: "rev-1" }] });
  }
  if (norm.includes("FROM trust.reputation")) {
    return Promise.resolve({ rows: [{ reputation_score: 72 }] });
  }
  return Promise.resolve({ rows: [] });
}

describe("createTrustHttpApp", () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete process.env.TRUST_HTTP_TIMING;
    poolQuery.mockReset();
    poolQuery.mockImplementation((sql: string) => defaultPool(sql));
  });

  afterEach(() => {
    delete process.env.TRUST_HTTP_TIMING;
  });

  it("GET /healthz — DB connected", async () => {
    const app = createTrustHttpApp();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body).toEqual({ ok: true, db: "connected" });
  });

  it("GET /health — DB disconnected still 200 with warning", async () => {
    poolQuery.mockRejectedValueOnce(new Error("econnrefused"));
    const app = createTrustHttpApp();
    const res = await request(app).get("/health").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe("disconnected");
  });

  it("enables slow-request diagnostics when TRUST_HTTP_TIMING=1", async () => {
    process.env.TRUST_HTTP_TIMING = "1";
    process.env.TRUST_HTTP_TIMING_MIN_MS = "0";
    const app = createTrustHttpApp();
    await request(app).get("/healthz").expect(200);
  });

  it("GET /metrics returns Prometheus text", async () => {
    const app = createTrustHttpApp();
    const res = await request(app).get("/metrics").expect(200);
    expect(res.headers["content-type"]).toMatch(/openmetrics|text/);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("POST /flag-listing — 401 without x-user-id", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .send({ listing_id: listingId, reason: "spam" })
      .expect(401);
  });

  it("POST /flag-listing — 400 missing fields", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: "", reason: "" })
      .expect(400);
  });

  it("POST /flag-listing — 400 invalid listing_id", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: "not-a-uuid", reason: "spam" })
      .expect(400);
  });

  it("POST /flag-listing — 400 invalid reporter", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .set("x-user-id", "bad-id")
      .send({ listing_id: listingId, reason: "spam" })
      .expect(400);
  });

  it("POST /flag-listing — 201", async () => {
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(201);
    expect(res.body.data.flag_id).toBe("flag-1");
  });

  it("POST /flag-listing — 409 duplicate", async () => {
    poolQuery.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(409);
  });

  it("POST /flag-listing — 500 internal", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(500);
  });

  it("POST /report-abuse — 401 without x-user-id", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .send({ abuse_target_type: "listing", target_id: listingId })
      .expect(401);
  });

  it("POST /report-abuse — 400 invalid target_id", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({ abuse_target_type: "listing", target_id: "nope" })
      .expect(400);
  });

  it("POST /report-abuse — 400 invalid reporter", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .set("x-user-id", "not-uuid")
      .send({ abuse_target_type: "user", target_id: targetUser })
      .expect(400);
  });

  it("POST /report-abuse — 400 bad target type", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({
        abuse_target_type: "other",
        target_id: listingId,
      })
      .expect(400);
  });

  it("POST /report-abuse — listing branch 201", async () => {
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({
        abuse_target_type: "listing",
        target_id: listingId,
        category: "abuse",
        details: "x",
      })
      .expect(201);
    expect(res.body.data.flag_id).toBe("flag-1");
  });

  it("POST /report-abuse — user branch 201", async () => {
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({
        abuse_target_type: "user",
        target_id: targetUser,
        category: "harassment",
        details: "",
      })
      .expect(201);
    expect(res.body.data.flag_id).toBe("uf-1");
  });

  it("POST /report-abuse — 409 duplicate", async () => {
    poolQuery.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({ abuse_target_type: "listing", target_id: listingId })
      .expect(409);
  });

  it("POST /report-abuse — 500", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({ abuse_target_type: "listing", target_id: listingId })
      .expect(500);
  });

  it("POST /peer-review — 401 without x-user-id", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/peer-review")
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        rating: 3,
      })
      .expect(401);
  });

  it("POST /peer-review — 400 missing rating", async () => {
    const app = createTrustHttpApp();
    await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        rating: 6,
      })
      .expect(400);
  });

  it("POST /peer-review — 201", async () => {
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        side: "guest",
        rating: 4,
        comment: "great",
      })
      .expect(201);
    expect(res.body.data.review_id).toBe("rev-1");
  });

  it("POST /peer-review — 409 duplicate (code)", async () => {
    poolQuery.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const app = createTrustHttpApp();
    await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        rating: 3,
      })
      .expect(409);
  });

  it("POST /peer-review — 409 duplicate (message unique)", async () => {
    poolQuery.mockRejectedValueOnce(new Error("unique constraint"));
    const app = createTrustHttpApp();
    await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        rating: 2,
      })
      .expect(409);
  });

  it("POST /peer-review — 500", async () => {
    poolQuery.mockRejectedValueOnce(new Error("syntax"));
    const app = createTrustHttpApp();
    await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        rating: 5,
      })
      .expect(500);
  });

  it("GET /reputation/:userId — 400 invalid uuid", async () => {
    const app = createTrustHttpApp();
    await request(app).get("/reputation/not-uuid").expect(400);
  });

  it("GET /reputation/:userId — 200 with score", async () => {
    const app = createTrustHttpApp();
    const res = await request(app).get(`/reputation/${targetUser}`).expect(200);
    expect(res.body.data).toMatchObject({ user_id: targetUser, score: 72 });
  });

  it("GET /reputation/:userId — 200 score 0 when no row", async () => {
    poolQuery.mockImplementation((sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("FROM trust.reputation")) {
        return Promise.resolve({ rows: [] });
      }
      return defaultPool(sql);
    });
    const app = createTrustHttpApp();
    const res = await request(app).get(`/reputation/${targetUser}`).expect(200);
    expect(res.body.data.score).toBe(0);
  });

  it("GET /reputation/:userId — 500", async () => {
    poolQuery.mockImplementation((sql: string) => {
      const norm = sql.replace(/\s+/g, " ").trim();
      if (norm.includes("FROM trust.reputation")) {
        return Promise.reject(new Error("db"));
      }
      return defaultPool(sql);
    });
    const app = createTrustHttpApp();
    await request(app).get(`/reputation/${targetUser}`).expect(500);
  });
});
