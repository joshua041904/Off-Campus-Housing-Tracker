/**
 * gRPC + Postgres (real {@link proto/listings.proto} surface).
 * Insecure gRPC bind + cluster Kafka + topic suffix come from {@link vitest.integration.config.mts}.
 */
import { createServer } from "node:net";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolveProtoPath, sumTopicHighWatermarks, waitForKafkaTopicHighBeyond } from "@common/utils";
import { kafka } from "@common/utils/kafka";
import pg from "pg";
import { pool } from "../src/db.js";
import { LISTING_EVENTS_TOPIC } from "../src/listing-kafka.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const conn = process.env.POSTGRES_URL_LISTINGS!;

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

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

describe.skipIf(!dbReady)("listings gRPC — Postgres integration", () => {
  let grpcPort: number;
  let server: grpc.Server;
  let client: grpc.Client;

  beforeAll(async () => {
    grpcPort = await pickFreePort();
    const { startGrpcServerAndWait } = await import("../src/grpc-server.js");
    server = await startGrpcServerAndWait(grpcPort);

    const pd = protoLoader.loadSync(resolveProtoPath("listings.proto"), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(pd) as {
      listings: { ListingsService: grpc.ServiceClientConstructor };
    };
    client = new loaded.listings.ListingsService(
      `127.0.0.1:${grpcPort}`,
      grpc.credentials.createInsecure(),
    ) as grpc.Client;

    await new Promise<void>((resolve, reject) => {
      const deadline = new Date(Date.now() + 10_000);
      client.waitForReady(deadline, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  afterAll(() => {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    try {
      server.forceShutdown();
    } catch {
      /* ignore */
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE listings.listings RESTART IDENTITY CASCADE");
  });

  const testUser = "33333333-3333-4333-8333-333333333333";

  it("CreateListing persists and GetListing returns the row", async () => {
    const hiBefore = await sumTopicHighWatermarks(kafka, LISTING_EVENTS_TOPIC);
    const title = `grpc-it-${Date.now()}`;
    const created = await new Promise<Record<string, unknown>>((resolve, reject) => {
      (client as any).createListing(
        {
          user_id: testUser,
          title,
          description: "grpc integration",
          price_cents: 199000,
          amenities: ["wifi"],
          smoke_free: true,
          pet_friendly: false,
          furnished: false,
          effective_from: "2026-08-01",
          effective_until: "",
        },
        (err: grpc.ServiceError | null, res: Record<string, unknown> | undefined) => {
          if (err) reject(err);
          else resolve(res ?? {});
        },
      );
    });

    const listingId = String(created.listing_id ?? "");
    expect(listingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    await waitForKafkaTopicHighBeyond(kafka, {
      topic: LISTING_EVENTS_TOPIC,
      minExclusive: hiBefore,
      timeoutMs: 20_000,
    });

    const got = await new Promise<Record<string, unknown>>((resolve, reject) => {
      (client as any).getListing(
        { listing_id: listingId },
        (err: grpc.ServiceError | null, res: Record<string, unknown> | undefined) => {
          if (err) reject(err);
          else resolve(res ?? {});
        },
      );
    });

    expect(String(got.title)).toBe(title);
    expect(String(got.user_id)).toBe(testUser);
  });
});
