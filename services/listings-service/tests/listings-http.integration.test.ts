/**
 * HTTP + Postgres + **cluster Kafka** (see `vitest.integration.config.mts` + `@common/utils/kafka-vitest-cluster`).
 * Requires `listings.listings` (5442 + bootstrap SQL) and the same Kafka/TLS setup as `pnpm run test:integration`.
 *
 *   pnpm --filter listings-service run test:integration
 *
 * Skips cleanly when DB is unreachable; Kafka misconfig fails during Vitest startup/globalSetup.
 */
process.env.POSTGRES_URL_LISTINGS ??= "postgresql://postgres:postgres@127.0.0.1:5442/listings";
process.env.ANALYTICS_SYNC_MODE ??= "0";

import type { Express } from "express";
import { sumTopicHighWatermarks, waitForKafkaTopicHighBeyond } from "@common/utils";
import { kafka } from "@common/utils/kafka";
import pg from "pg";
import request from "supertest";
import { LISTING_EVENTS_TOPIC } from "../src/listing-kafka.js";
import { beforeAll, describe, expect, it } from "vitest";

const conn = process.env.POSTGRES_URL_LISTINGS!;

async function listingsSchemaReady(): Promise<boolean> {
  let client: pg.Client | undefined;
  try {
    client = new pg.Client({ connectionString: conn, connectionTimeoutMillis: 5000 });
    await client.connect();
    const { rows } = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM information_schema.tables
       WHERE table_schema = 'listings' AND table_name = 'listings'`,
    );
    return rows[0]?.c === "1";
  } catch {
    return false;
  } finally {
    try {
      await client?.end();
    } catch {
      /* ignore */
    }
  }
}

const dbReady = await listingsSchemaReady();

describe.skipIf(!dbReady)("listings HTTP — Postgres integration", () => {
  let app: Express;

  beforeAll(async () => {
    const mod = await import("../src/http-server.js");
    app = mod.createListingsHttpApp();
  });

  const testUser = "22222222-2222-4222-8222-222222222222";

  it("GET /healthz returns 200", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("GET /metrics returns Prometheus text", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"] || "")).toMatch(/text\/plain/);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("GET / (root search) returns 200 with items array", async () => {
    const res = await request(app).get("/").query({ q: "integration-root-search-no-match" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it(
    "POST /create returns 201 and row is readable via GET and SQL",
    async () => {
      const hiBefore = await sumTopicHighWatermarks(kafka, LISTING_EVENTS_TOPIC);
      const slug = `http-it-${Date.now()}`;
      const res = await request(app)
        .post("/create")
        .set("x-user-id", testUser)
        .send({
          title: `Integration ${slug}`,
          description: "supertest + live Postgres",
          price_cents: 250000,
          amenities: ["parking"],
          smoke_free: true,
          pet_friendly: false,
          furnished: true,
          effective_from: "2026-07-01",
          effective_until: "",
        });
      expect(res.status, res.text).toBe(201);
      const id = res.body?.id as string | undefined;
      expect(id).toBeTruthy();

      await waitForKafkaTopicHighBeyond(kafka, {
        topic: LISTING_EVENTS_TOPIC,
        minExclusive: hiBefore,
        timeoutMs: 20_000,
      });

      const get = await request(app).get(`/listings/${id}`);
      expect(get.status, get.text).toBe(200);
      expect(String(get.body.title)).toContain("Integration");

      const verify = new pg.Client({ connectionString: conn });
      await verify.connect();
      try {
        const row = await verify.query("SELECT id FROM listings.listings WHERE id = $1::uuid AND deleted_at IS NULL", [
          id,
        ]);
        expect(row.rows.length).toBe(1);
      } finally {
        await verify.end();
      }
    },
    60_000,
  );

  it("GET /listings/:id returns 400 for invalid uuid", async () => {
    const res = await request(app).get("/listings/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("GET /search returns items array", async () => {
    const res = await request(app).get("/search").query({ q: "zzzz-no-match-integration" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
