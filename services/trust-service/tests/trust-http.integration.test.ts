/**
 * Integration tests: trust HTTP against real Postgres (5446).
 * Run: cd services/trust-service && pnpm run test:integration
 * Skip: SKIP_TRUST_INTEGRATION=1 or no DB
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createTrustHttpApp } from "../src/http-server.js";
import { pool } from "../src/db.js";

const skip =
  process.env.SKIP_TRUST_INTEGRATION === "1" ||
  process.env.SKIP_TRUST_INTEGRATION === "true";

describe.skipIf(skip)("trust HTTP integration", () => {
  let server: Server;
  let baseUrl: string;
  const reporter = randomUUID();
  const listingId = randomUUID();
  const targetUser = randomUUID();
  const bookingId = randomUUID();
  const revieweeId = randomUUID();

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      throw new Error(
        "Trust DB unreachable (POSTGRES_URL_TRUST / port 5446). Start Postgres or set SKIP_TRUST_INTEGRATION=1",
      );
    }
    const app = createTrustHttpApp();
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string")
      throw new Error("could not bind HTTP server");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
    });
    await pool.end();
  });

  it("rejects flag-listing without x-user-id", async () => {
    const res = await fetch(`${baseUrl}/flag-listing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: listingId, reason: "spam" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /flag-listing creates listing_flags row", async () => {
    const res = await fetch(`${baseUrl}/flag-listing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        listing_id: listingId,
        reason: "e2e integration — inappropriate",
      }),
    });
    expect(res.status).toBe(201);
    const j = (await res.json()) as { flag_id: string; status: string };
    expect(j.flag_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(j.status).toBe("pending");

    const q = await pool.query(
      `SELECT listing_id::text, reporter_id::text, reason FROM trust.listing_flags WHERE id = $1::uuid`,
      [j.flag_id],
    );
    expect(q.rows[0].listing_id).toBe(listingId);
    expect(q.rows[0].reporter_id).toBe(reporter);
  });

  it("POST /report-abuse listing path", async () => {
    const res = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        abuse_target_type: "listing",
        target_id: randomUUID(),
        category: "scam",
        details: "integration test",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /report-abuse user path", async () => {
    const res = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        abuse_target_type: "user",
        target_id: targetUser,
        category: "harassment",
        details: "integration test user report",
      }),
    });
    expect(res.status).toBe(201);
    const j = (await res.json()) as { flag_id: string };
    const q = await pool.query(
      `SELECT user_id::text, reporter_id::text FROM trust.user_flags WHERE id = $1::uuid`,
      [j.flag_id],
    );
    expect(q.rows[0].user_id).toBe(targetUser);
    expect(q.rows[0].reporter_id).toBe(reporter);
  });

  it("POST /peer-review then GET /reputation", async () => {
    const res = await fetch(`${baseUrl}/peer-review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        side: "tenant_rates_landlord",
        rating: 4,
        comment: "integration peer review",
      }),
    });
    expect(res.status).toBe(201);

    const rep = await fetch(`${baseUrl}/reputation/${encodeURIComponent(revieweeId)}`);
    expect(rep.status).toBe(200);
    const body = (await rep.json()) as { user_id: string; score: number };
    expect(body.user_id).toBe(revieweeId);
    expect(typeof body.score).toBe("number");
  });
});
