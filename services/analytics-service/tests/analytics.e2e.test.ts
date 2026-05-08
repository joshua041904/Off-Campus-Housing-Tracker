/**
 * HTTP surface + Ollama resilience (no live Postgres/Redis — mocked pool + locks).
 */
import type { Application } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    acquireLockWithToken: vi.fn().mockResolvedValue(true),
    releaseLockWithToken: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
  },
}));

vi.mock("../src/booking-read-pool.js", () => ({ bookingReadPool: null }));
vi.mock("../src/lib/hybrid-search.js", () => ({
  runHybridSearch: vi.fn(async ({ query }: { query: string }) => [
    {
      listing_id: "00000000-0000-0000-0000-000000000001",
      title: "Hybrid listing",
      description: query,
      score: 0.91,
      vector_score: 0.88,
      keyword_score: 0.62,
      recency_score: 0.73,
    },
  ]),
}));

describe("analytics e2e-lite", () => {
  let app: Application;

  beforeAll(async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (/information_schema|booking\./i.test(sql)) return { rows: [] };
      if (/listing_feel_cache/i.test(sql) && /SELECT/i.test(sql)) return { rows: [] };
      if (/SELECT 1/i.test(sql)) return { rows: [{}] };
      if (/INSERT INTO analytics\.listing_feel_cache/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });
    const mod = await import("../src/http-server.js");
    app = mod.createAnalyticsHttpApp();
  });

  it("GET /healthz returns 200", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("GET /readyz returns 200 when DB up", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ready: true });
  });

  it("POST /insights/listing-feel — failed Ollama → rule-based fallback + schema", async () => {
    const prevUrl = process.env.OLLAMA_BASE_URL;
    const prevModel = process.env.OLLAMA_MODEL;
    const prevStrict = process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA;
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    process.env.OLLAMA_MODEL = "stub-model";
    delete process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await request(app)
      .post("/insights/listing-feel")
      .set("Content-Type", "application/json")
      .send({ title: "Cozy studio", description: "Near campus", price_cents: 120000, audience: "renter" });

    process.env.OLLAMA_BASE_URL = prevUrl;
    process.env.OLLAMA_MODEL = prevModel;
    process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA = prevStrict;
    vi.unstubAllGlobals();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        analysis_text: expect.any(String),
        model_used: "rule-based-fallback",
        quality_score: expect.any(Number),
      })
    );
    expect(String(res.body.analysis_text).length).toBeGreaterThan(10);
  });

  it("POST /insights/listing-feel — strict Ollama returns 500 when upstream fails", async () => {
    const prevUrl = process.env.OLLAMA_BASE_URL;
    const prevModel = process.env.OLLAMA_MODEL;
    const prevStrict = process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA;
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
    process.env.OLLAMA_MODEL = "stub-model";
    process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA = "1";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await request(app)
      .post("/insights/listing-feel")
      .set("Content-Type", "application/json")
      .send({ title: "Strict studio", description: "Near campus", price_cents: 120000, audience: "renter" });

    process.env.OLLAMA_BASE_URL = prevUrl;
    process.env.OLLAMA_MODEL = prevModel;
    process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA = prevStrict;
    vi.unstubAllGlobals();

    expect(res.status).toBe(500);
  });

  it("POST /insights/hybrid-search returns ranked items", async () => {
    const res = await request(app)
      .post("/insights/hybrid-search")
      .set("Content-Type", "application/json")
      .send({ query: "cheap apartment near campus", limit: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query: "cheap apartment near campus",
      count: 1,
      ranking: "hybrid(bm25+pgvector)+ltr",
      items: expect.any(Array),
    });
    expect(res.body.items[0]).toMatchObject({
      listing_id: expect.any(String),
      title: expect.any(String),
      score: expect.any(Number),
    });
  });
});
