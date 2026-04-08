/**
 * Booking HTTP + Postgres (5443). Exercises every HTTP route on createBookingHttpApp().
 *
 *   pnpm --filter booking-service run test:integration
 *
 * Skip: SKIP_BOOKING_INTEGRATION=1 or no DB / missing tenant_notes column.
 *
 * Kafka: cluster-only — `vitest.integration.config.mts` + `@common/utils/kafka-vitest-cluster` (≥3 TLS seeds). No plaintext.
 * See README; GitHub Actions does not run this suite.
 * Caddy/limit-finder ingress restarts: docs/runbooks/caddy-colima-limit-finder-restarts.md
 */
process.env.POSTGRES_URL_BOOKINGS ??= "postgresql://postgres:postgres@127.0.0.1:5443/bookings";

import type { Express } from "express";
import pg from "pg";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const conn = process.env.POSTGRES_URL_BOOKINGS!;

async function bookingSchemaReady(): Promise<boolean> {
  let client: pg.Client | undefined;
  try {
    client = new pg.Client({ connectionString: conn, connectionTimeoutMillis: 5000 });
    await client.connect();
    const { rows } = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM information_schema.columns
       WHERE table_schema = 'booking' AND table_name = 'bookings' AND column_name = 'tenant_notes'`,
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

const dbReady = await bookingSchemaReady();
const skip = process.env.SKIP_BOOKING_INTEGRATION === "1" || process.env.SKIP_BOOKING_INTEGRATION === "true";

describe.skipIf(skip || !dbReady)("booking HTTP — full surface", () => {
  let app: Express;
  const tenantId = randomUUID();
  const otherUser = randomUUID();
  const start = "2030-06-01";
  const end = "2030-06-15";

  beforeAll(async () => {
    const mod = await import("../src/http-app.js");
    app = mod.createBookingHttpApp();
  });

  afterAll(async () => {
    await import("../src/lib/prisma.js").then((m) => m.prisma.$disconnect());
  });

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

  it("POST /create 401 without x-user-id", async () => {
    const res = await request(app)
      .post("/create")
      .send({ listingId: randomUUID(), startDate: start, endDate: end });
    expect(res.status).toBe(401);
  });

  it("POST /create 400 when listingId missing", async () => {
    const res = await request(app).post("/create").set("x-user-id", tenantId).send({ startDate: start, endDate: end });
    expect(res.status).toBe(400);
  });

  it("POST /create 201 and POST /confirm 200 → status confirmed", async () => {
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({
        listingId: randomUUID(),
        startDate: start,
        endDate: end,
        priceCents: 5000,
      });
    expect(create.status, create.text).toBe(201);
    const bookingId = create.body.id as string;

    const conf = await request(app)
      .post("/confirm")
      .set("x-user-id", tenantId)
      .send({ bookingId });
    expect(conf.status, conf.text).toBe(200);
    expect(conf.body.status).toBe("confirmed");
    expect(conf.body.confirmedAt).toBeTruthy();
  });

  it("POST /search-history 201 and GET /search-history/list returns row", async () => {
    const q = `integration-q-${Date.now()}`;
    const post = await request(app)
      .post("/search-history")
      .set("x-user-id", tenantId)
      .send({ query: q, maxDistanceKm: 3 });
    expect(post.status, post.text).toBe(201);
    expect(post.body.query).toBe(q);

    const list = await request(app).get("/search-history/list").set("x-user-id", tenantId);
    expect(list.status, list.text).toBe(200);
    const items = list.body.items as { query?: string }[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((r) => r.query === q)).toBe(true);
  });

  it("POST /watchlist/add, GET /watchlist/list, POST /watchlist/remove", async () => {
    const lid = randomUUID();
    const add = await request(app)
      .post("/watchlist/add")
      .set("x-user-id", tenantId)
      .send({ listingId: lid, source: "integration" });
    expect(add.status, add.text).toBe(201);

    const list = await request(app).get("/watchlist/list").set("x-user-id", tenantId);
    expect(list.status).toBe(200);
    expect((list.body.items as { listingId: string }[]).some((i) => i.listingId === lid)).toBe(true);

    const rem = await request(app)
      .post("/watchlist/remove")
      .set("x-user-id", tenantId)
      .send({ listingId: lid });
    expect(rem.status).toBe(200);
    expect(rem.body.removed).toBeGreaterThanOrEqual(1);

    const list2 = await request(app).get("/watchlist/list").set("x-user-id", tenantId);
    expect(list2.status).toBe(200);
    expect((list2.body.items as { listingId: string }[]).some((i) => i.listingId === lid)).toBe(false);
  });

  it("GET /:bookingId 400 for invalid UUID", async () => {
    const res = await request(app).get("/not-a-uuid").set("x-user-id", tenantId);
    expect(res.status).toBe(400);
  });

  it("GET /:bookingId 403 for non-tenant", async () => {
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId: randomUUID(), startDate: start, endDate: end });
    expect(create.status).toBe(201);
    const bookingId = create.body.id as string;

    const res = await request(app).get(`/${bookingId}`).set("x-user-id", otherUser);
    expect(res.status).toBe(403);
  });

  it("PATCH /:bookingId 400 when tenantNotes omitted", async () => {
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId: randomUUID(), startDate: start, endDate: end });
    const bookingId = create.body.id as string;

    const res = await request(app).patch(`/${bookingId}`).set("x-user-id", tenantId).send({});
    expect(res.status).toBe(400);
  });

  it("POST /create → PATCH tenantNotes → GET → clear notes → POST /cancel → PATCH blocked → cancel 409", async () => {
    const listingId = randomUUID();
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({
        listingId,
        startDate: start,
        endDate: end,
        priceCents: 10000,
      });
    expect(create.status, create.text).toBe(201);
    const bookingId = create.body?.id as string;
    expect(bookingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const patch = await request(app)
      .patch(`/${bookingId}`)
      .set("x-user-id", tenantId)
      .send({ tenantNotes: "Near campus — need ground floor" });
    expect(patch.status, patch.text).toBe(200);
    expect(patch.body.tenantNotes).toBe("Near campus — need ground floor");

    const get = await request(app).get(`/${bookingId}`).set("x-user-id", tenantId);
    expect(get.status, get.text).toBe(200);
    expect(get.body.tenantNotes).toBe("Near campus — need ground floor");

    const clear = await request(app)
      .patch(`/${bookingId}`)
      .set("x-user-id", tenantId)
      .send({ tenantNotes: null });
    expect(clear.status, clear.text).toBe(200);
    expect(clear.body.tenantNotes).toBeNull();

    const cancel = await request(app)
      .post("/cancel")
      .set("x-user-id", tenantId)
      .send({ bookingId });
    expect(cancel.status, cancel.text).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    expect(cancel.body.cancelledAt).toBeTruthy();

    const patchAfter = await request(app)
      .patch(`/${bookingId}`)
      .set("x-user-id", tenantId)
      .send({ tenantNotes: "too late" });
    expect(patchAfter.status).toBe(409);

    const cancelAgain = await request(app)
      .post("/cancel")
      .set("x-user-id", tenantId)
      .send({ bookingId });
    expect(cancelAgain.status).toBe(409);
    expect(cancelAgain.body.error).toMatch(/already cancelled/i);
  });

  it("PATCH tenantNotes 403 for non-tenant", async () => {
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId: randomUUID(), startDate: start, endDate: end });
    expect(create.status).toBe(201);
    const bookingId = create.body.id as string;

    const bad = await request(app)
      .patch(`/${bookingId}`)
      .set("x-user-id", otherUser)
      .send({ tenantNotes: "hacker" });
    expect(bad.status).toBe(403);
  });

  it("POST /cancel 403 for unrelated user", async () => {
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({ listingId: randomUUID(), startDate: start, endDate: end });
    const bookingId = create.body.id as string;

    const bad = await request(app)
      .post("/cancel")
      .set("x-user-id", otherUser)
      .send({ bookingId });
    expect(bad.status).toBe(403);
  });

  it("POST /cancel 200 for landlord when landlordId differs from tenant", async () => {
    const landlordId = randomUUID();
    const create = await request(app)
      .post("/create")
      .set("x-user-id", tenantId)
      .send({
        listingId: randomUUID(),
        startDate: start,
        endDate: end,
        landlordId,
      });
    expect(create.status).toBe(201);
    const bookingId = create.body.id as string;

    const cancel = await request(app)
      .post("/cancel")
      .set("x-user-id", landlordId)
      .send({ bookingId });
    expect(cancel.status, cancel.text).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
  });

  it("POST /search-history and watchlist 401 without x-user-id", async () => {
    const sh = await request(app).post("/search-history").send({ query: "x" });
    expect(sh.status).toBe(401);
    const wl = await request(app).post("/watchlist/add").send({ listingId: randomUUID() });
    expect(wl.status).toBe(401);
  });
});
