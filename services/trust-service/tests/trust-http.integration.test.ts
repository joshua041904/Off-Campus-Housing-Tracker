/**
 * Integration tests: trust HTTP against real Postgres (5446). **No Kafka** — not a cluster-backed event suite.
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
  let server!: Server;
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
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      });
    }
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
    const j = (await res.json()) as {
      data: { flag_id: string; status: string };
    };
    expect(j.data.flag_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(j.data.status).toBe("pending");

    const q = await pool.query(
      `SELECT listing_id::text, reporter_id::text, reason FROM trust.listing_flags WHERE id = $1::uuid`,
      [j.data.flag_id],
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
    const j = (await res.json()) as {
      data: { flag_id: string; status?: string };
    };
    const q = await pool.query(
      `SELECT user_id::text, reporter_id::text FROM trust.user_flags WHERE id = $1::uuid`,
      [j.data.flag_id],
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

    const rep = await fetch(
      `${baseUrl}/reputation/${encodeURIComponent(revieweeId)}`,
    );
    expect(rep.status).toBe(200);
    const body = (await rep.json()) as {
      data: { user_id: string; score: number };
    };
    expect(body.data.user_id).toBe(revieweeId);
    expect(typeof body.data.score).toBe("number");
  });

  it("POST /flag-listing returns 409 on duplicate reporter/listing", async () => {
    const listingId = randomUUID();
    const reporter = randomUUID();

    const first = await fetch(`${baseUrl}/flag-listing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        listing_id: listingId,
        reason: "duplicate listing flag test",
      }),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/flag-listing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        listing_id: listingId,
        reason: "duplicate listing flag test",
      }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("duplicate flag");
  });

  it("POST /report-abuse listing returns 409 on duplicate reporter/target", async () => {
    const targetId = randomUUID();
    const reporter = randomUUID();

    const first = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        abuse_target_type: "listing",
        target_id: targetId,
        category: "spam",
        details: "duplicate listing abuse test",
      }),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        abuse_target_type: "listing",
        target_id: targetId,
        category: "spam",
        details: "duplicate listing abuse test",
      }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("duplicate flag");
  });

  it("POST /report-abuse user returns 409 on duplicate reporter/target", async () => {
    const userId = randomUUID();
    const reporter = randomUUID();

    const first = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        abuse_target_type: "user",
        target_id: userId,
        category: "harassment",
        details: "duplicate user abuse test",
      }),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": reporter,
      },
      body: JSON.stringify({
        abuse_target_type: "user",
        target_id: userId,
        category: "harassment",
        details: "duplicate user abuse test",
      }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("duplicate flag");
  });

  it("POST /flag-listing returns 400 for invalid listing_id", async () => {
    const res = await fetch(`${baseUrl}/flag-listing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": randomUUID(),
      },
      body: JSON.stringify({
        listing_id: "not-a-uuid",
        reason: "invalid test",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe("invalid listing_id");
    expect(body.code).toBe("INVALID_ID");
  });

  it("POST /report-abuse returns 400 for invalid target_id", async () => {
    const res = await fetch(`${baseUrl}/report-abuse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": randomUUID(),
      },
      body: JSON.stringify({
        abuse_target_type: "listing",
        target_id: "not-a-uuid",
        category: "spam",
        details: "invalid test",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe("invalid target_id");
    expect(body.code).toBe("INVALID_ID");
  });

  it("GET /reputation returns 400 for invalid user_id", async () => {
    const res = await fetch(`${baseUrl}/reputation/not-a-uuid`);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe("invalid user_id");
    expect(body.code).toBe("INVALID_ID");
  });
});
