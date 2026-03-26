import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { randomUUID } from "node:crypto";
import {
  registerHealthService,
  resolveProtoPath,
  kafka,
  createOchStrictMtlsServerCredentials,
} from "@common/utils";
import { pool } from "./db.js";

import { validateCreateListingInput, validateListingId } from "./validation.js";

// Logs per-request gRPC latency and marks requests over 100ms as slow.
function logGrpcTiming(method: string, start: number) {
  const ms = Date.now() - start;
  const slow = ms > 100;

  console.log(
    `[listings gRPC] ${slow ? "SLOW REQUEST " : ""}method=${method} latency_ms=${ms}`,
  );
}

const LISTINGS_PROTO = resolveProtoPath("listings.proto");
const packageDefinition = protoLoader.loadSync(LISTINGS_PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const listingsProto = grpc.loadPackageDefinition(packageDefinition) as any;
const ENV_PREFIX = process.env.ENV_PREFIX || "dev";
// Must match topics created by scripts/create-kafka-event-topics.sh (${ENV_PREFIX}.listing.events)
const LISTING_EVENTS_TOPIC =
  process.env.LISTING_EVENTS_TOPIC || `${ENV_PREFIX}.listing.events`;
const SERVICE_NAME = "listings-service";

const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  try {
    const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
    await Promise.race([
      producer.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("kafka connect timeout")), connectMs),
      ),
    ]);
    producerReady = true;
  } catch {
    /* non-fatal */
  }
}

async function publishListingEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await ensureProducer();
    if (!producerReady) return;
    await producer.send({
      topic: LISTING_EVENTS_TOPIC,
      messages: [
        {
          key: aggregateId,
          value: JSON.stringify({
            metadata: {
              event_id: randomUUID(),
              event_type: eventType,
              aggregate_id: aggregateId,
              aggregate_type: "listing",
              occurred_at: new Date().toISOString(),
              producer: SERVICE_NAME,
              version: "1",
            },
            payload,
          }),
        },
      ],
    });
  } catch {
    /* non-fatal */
  }
}

function amenitiesToStrings(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object")
    return Object.values(raw as object).map(String);
  return [];
}

function rowToResponse(row: Record<string, unknown>) {
  return {
    listing_id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    price_cents: Number(row.price_cents ?? 0),
    amenities: amenitiesToStrings(row.amenities),
    smoke_free: Boolean(row.smoke_free),
    pet_friendly: Boolean(row.pet_friendly),
    furnished: row.furnished != null ? Boolean(row.furnished) : false,
    status: String(row.status ?? "active"),
    created_at: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
  };
}

const listingsService = {
  CreateListing(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ) {
    const start = Date.now();
    const req = call.request;

    const validation = validateCreateListingInput(req, { requireUserId: true });
    if (!validation.ok) {
      logGrpcTiming("CreateListing", start);
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: validation.message,
      });
      return;
    }

    const input = validation.value;

    const query = `
    INSERT INTO listings.listings (
      user_id,
      title,
      description,
      price_cents,
      amenities,
      smoke_free,
      pet_friendly,
      furnished,
      effective_from,
      effective_until,
      listed_at
    )
    VALUES (
      $1::uuid,
      $2,
      $3,
      $4,
      $5::jsonb,
      $6,
      $7,
      $8,
      $9::date,
      NULLIF($10, '')::date,
      CURRENT_DATE
    )
    RETURNING
      id,
      user_id,
      title,
      description,
      price_cents,
      amenities,
      smoke_free,
      pet_friendly,
      furnished,
      status,
      created_at
  `;

    const values = [
      input.user_id,
      input.title,
      input.description,
      input.price_cents,
      JSON.stringify(input.amenities),
      input.smoke_free,
      input.pet_friendly,
      input.furnished,
      input.effective_from,
      input.effective_until,
    ];

    pool
      .query(query, values)
      .then((result) => {
        const row = result.rows[0];
        void publishListingEvent("ListingCreatedV1", row.id, {
          listing_id: row.id,
          user_id: row.user_id,
          title: row.title,
          price_cents: row.price_cents,
        });
        logGrpcTiming("CreateListing", start);
        callback(null, rowToResponse(row));
      })
      .catch((error) => {
        console.error("[CreateListing]", error);
        logGrpcTiming("CreateListing", start);
        callback({
          code: grpc.status.INTERNAL,
          message: "failed to create listing",
        });
      });
  },

  GetListing(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ) {
    const start = Date.now();
    const validation = validateListingId(call.request?.listing_id);
    if (!validation.ok) {
      logGrpcTiming("GetListing", start);
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: validation.message,
      });
      return;
    }

    const id = validation.value;
    pool
      .query(
        `SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
         FROM listings.listings
         WHERE id = $1::uuid
           AND (deleted_at IS NULL)
         LIMIT 1`,
        [id],
      )
      .then((res) => {
        if (!res.rows[0]) {
          logGrpcTiming("GetListing", start);
          callback({
            code: grpc.status.NOT_FOUND,
            message: "listing not found",
          });
          return;
        }
        logGrpcTiming("GetListing", start);
        callback(null, rowToResponse(res.rows[0]));
      })
      .catch((e) => {
        console.error("[GetListing]", e);
        logGrpcTiming("GetListing", start);
        callback({ code: grpc.status.INTERNAL, message: "internal" });
      });
  },

  SearchListings(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ) {
    const start = Date.now();
    const req = call.request || {};
    const q = String(req.query || "").trim();
    const minP =
      req.min_price != null && req.min_price !== ""
        ? Number(req.min_price)
        : null;
    const maxP =
      req.max_price != null && req.max_price !== ""
        ? Number(req.max_price)
        : null;
    const smoke = Boolean(req.smoke_free);
    const pets = Boolean(req.pet_friendly);

    const params: unknown[] = [];
    let i = 1;
    const where: string[] = [`status::text = 'active'`, `(deleted_at IS NULL)`];
    if (q) {
      where.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
      params.push(`%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
      i++;
    }
    if (minP != null && !Number.isNaN(minP)) {
      where.push(`price_cents >= $${i}`);
      params.push(minP);
      i++;
    }
    if (maxP != null && !Number.isNaN(maxP)) {
      where.push(`price_cents <= $${i}`);
      params.push(maxP);
      i++;
    }
    if (smoke) {
      where.push(`smoke_free = true`);
    }
    if (pets) {
      where.push(`pet_friendly = true`);
    }

    const sql = `
      SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
      FROM listings.listings
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    pool
      .query(sql, params)
      .then((res) => {
        logGrpcTiming("SearchListings", start);
        callback(null, { listings: res.rows.map((r) => rowToResponse(r)) });
      })
      .catch((e) => {
        console.error("[SearchListings]", e);
        logGrpcTiming("SearchListings", start);
        callback({ code: grpc.status.INTERNAL, message: "search failed" });
      });
  },
};

export function startGrpcServer(port: number): grpc.Server {
  const server = new grpc.Server();
  server.addService(listingsProto.listings.ListingsService.service, {
    CreateListing: listingsService.CreateListing,
    GetListing: listingsService.GetListing,
    SearchListings: listingsService.SearchListings,
  });

  registerHealthService(server, "listings.ListingsService", async () => {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  });

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createOchStrictMtlsServerCredentials("listings gRPC");
    console.log("[listings gRPC] strict mTLS (client cert required)");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(
    `0.0.0.0:${port}`,
    credentials,
    (err: Error | null, boundPort: number) => {
      if (err) {
        console.error("[listings gRPC] bind error:", err);
        return;
      }
      server.start();
      console.log(`[listings gRPC] listening on ${boundPort}`);
    },
  );

  return server;
}
