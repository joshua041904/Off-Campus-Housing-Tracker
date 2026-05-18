import { randomUUID } from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  registerHealthService,
  resolveProtoPath,
  createOchGrpcServerCredentialsForBind,
} from "@common/utils";
import { publishListingEventForCreateResponse } from "./listing-kafka.js";
import { syncListingCreatedToAnalytics } from "./analytics-sync.js";
import { pool } from "./db.js";
import {
  buildListingsSearchQuery,
  parseAmenitySlugs,
  parseResidenceTypesCsv,
} from "./search-listings-query.js";

import { validateCreateListingInput, validateListingId } from "./validation.js";
import { buildDisplayLocationForCreate } from "./location-display.js";
import { geocodeStructuredAddress } from "./geocode-address.js";
import { fireSavedSearchNotifyForNewListing } from "./notify-saved-search-on-create.js";

// Logs per-request gRPC latency and marks requests over 100ms as slow.
function logGrpcTiming(method: string, start: number) {
  const ms = Date.now() - start;
  const slow = ms > 100;

  console.log(
    `[listings gRPC] ${slow ? "SLOW REQUEST " : ""}method=${method} latency_ms=${ms}`,
  );
}

function grpcMetaUsername(call: grpc.ServerUnaryCall<any, any>): string {
  try {
    const arr = call.metadata?.get("x-user-username");
    const first = arr?.[0];
    const s = Buffer.isBuffer(first) ? first.toString("utf8") : String(first ?? "");
    return s.trim().slice(0, 120);
  } catch {
    return "";
  }
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
    residence_type: row.residence_type != null ? String(row.residence_type) : "",
    size_sqft: row.size_sqft != null ? Number(row.size_sqft) : 0,
    city: row.city != null ? String(row.city) : "",
    state_or_province: row.state_or_province != null ? String(row.state_or_province) : "",
    country: row.country != null ? String(row.country) : "",
    created_at: row.created_at
      ? new Date(row.created_at as string | Date).toISOString()
      : new Date().toISOString(),
  };
}

function dedupeListingsById(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** Exported for unit tests (no bind / no TLS). */
export const listingsGrpcHandlersForTest = {
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
    const bodyRec = req as Record<string, unknown>;
    let lat =
      req.latitude != null && Number.isFinite(Number(req.latitude))
        ? Number(req.latitude)
        : null;
    let lng =
      req.longitude != null && Number.isFinite(Number(req.longitude))
        ? Number(req.longitude)
        : null;
    let displayLocation = buildDisplayLocationForCreate(bodyRec, lat, lng, input.title);

    const query = `
    INSERT INTO listings.listings (
      user_id,
      username_display,
      title,
      description,
      price_cents,
      amenities,
      smoke_free,
      pet_friendly,
      furnished,
      effective_from,
      effective_until,
      listed_at,
      latitude,
      longitude,
      display_location,
      residence_type,
      size_sqft,
      address_line1,
      address_line2,
      city,
      state_or_province,
      postal_code,
      country,
      neighborhood,
      bedrooms,
      bathrooms
    )
    VALUES (
      $1::uuid,
      NULLIF(TRIM($2::text), ''),
      $3,
      $4,
      $5,
      $6::jsonb,
      $7,
      $8,
      $9,
      $10::date,
      NULLIF($11, '')::date,
      CURRENT_DATE,
      $12,
      $13,
      $14,
      $15::text,
      $16::int,
      $17,
      $18,
      $19,
      $20,
      $21,
      $22,
      $23,
      $24::int,
      $25::numeric
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
      created_at,
      listed_at,
      latitude,
      longitude,
      display_location,
      residence_type,
      size_sqft,
      address_line1,
      address_line2,
      city,
      state_or_province,
      postal_code,
      country,
      neighborhood,
      bedrooms,
      bathrooms
  `;

    const geoMaybe =
      (lat == null || lng == null) &&
      input.address_line1 &&
      input.city &&
      input.state_or_province &&
      input.country
        ? geocodeStructuredAddress({
            address_line1: input.address_line1,
            address_line2: input.address_line2,
            city: input.city,
            state_or_province: input.state_or_province,
            postal_code: input.postal_code,
            country: input.country,
          })
        : Promise.resolve(null);

    void geoMaybe
      .then((g) => {
        if (g) {
          lat = g.lat;
          lng = g.lng;
        }
        displayLocation =
          buildDisplayLocationForCreate(bodyRec, lat, lng, input.title) ?? displayLocation;
        const hostHandle = grpcMetaUsername(call);
        const values = [
          input.user_id,
          hostHandle || "",
          input.title,
          input.description,
          input.price_cents,
          JSON.stringify(input.amenities),
          input.smoke_free,
          input.pet_friendly,
          input.furnished,
          input.effective_from,
          input.effective_until,
          lat,
          lng,
          displayLocation,
          input.residence_type,
          input.size_sqft,
          input.address_line1,
          input.address_line2,
          input.city,
          input.state_or_province,
          input.postal_code,
          input.country,
          input.neighborhood,
          input.bedrooms,
          input.bathrooms,
        ];
        return pool.query(query, values);
      })
      .then(async (result) => {
        const row = result.rows[0];
        const listedDay =
          row.listed_at != null
            ? new Date(row.listed_at as string | Date)
                .toISOString()
                .slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        const eventId = randomUUID();
        try {
          await syncListingCreatedToAnalytics({
            eventId,
            listedAtDay: listedDay,
          });
        } catch (e) {
          console.error("[CreateListing] analytics sync", e);
          callback({
            code: grpc.status.INTERNAL,
            message: "analytics projection sync failed",
          });
          return;
        }
        try {
          await publishListingEventForCreateResponse(
            "ListingCreatedV1",
            row.id,
            {
              listing_id: row.id,
              user_id: row.user_id,
              title: row.title,
              price_cents: row.price_cents,
              listed_at_day: listedDay,
            },
            eventId,
          );
        } catch (e) {
          console.error("[CreateListing] kafka", e);
          callback({
            code: grpc.status.INTERNAL,
            message: "listing event publish failed",
          });
          return;
        }
        fireSavedSearchNotifyForNewListing({
          listing_id: String(row.id),
          landlord_user_id: String(row.user_id),
          title: String(row.title),
          price_cents: Number(row.price_cents),
          residence_type: input.residence_type,
          size_sqft: input.size_sqft,
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          latitude: lat,
          longitude: lng,
          status: row.status != null ? String(row.status) : "active",
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
        `SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
                status::text AS status, created_at,
                residence_type, size_sqft, city, state_or_province, country
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
    const furnished = Boolean(req.furnished);
    const amenitySlugs = parseAmenitySlugs(
      String(req.amenities_contains || ""),
    );
    const nwdRaw =
      req.new_within_days != null && req.new_within_days !== ""
        ? Number(req.new_within_days)
        : null;
    const newWithin =
      nwdRaw != null && Number.isFinite(nwdRaw) && nwdRaw > 0 && nwdRaw <= 365
        ? Math.floor(nwdRaw)
        : null;
    const sort = String(req.sort || "created_desc").trim();

    const limitRaw =
      req.limit != null && req.limit !== "" ? Number(req.limit) : null;
    const offsetRaw =
      req.offset != null && req.offset !== "" ? Number(req.offset) : null;

    const limit =
      limitRaw != null && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.floor(limitRaw)
        : null;

    const offset =
      offsetRaw != null && Number.isFinite(offsetRaw) && offsetRaw >= 0
        ? Math.floor(offsetRaw)
        : null;

    const residenceTypes = parseResidenceTypesCsv(
      String(req.residence_types || req.residence_type || ""),
    );
    const minSqftRaw =
      req.min_sqft != null && req.min_sqft !== "" ? Number(req.min_sqft) : null;
    const minSqft =
      minSqftRaw != null && Number.isFinite(minSqftRaw) && minSqftRaw > 0
        ? Math.floor(minSqftRaw)
        : null;
    const maxSqftRaw =
      req.max_sqft != null && req.max_sqft !== "" ? Number(req.max_sqft) : null;
    const maxSqft =
      maxSqftRaw != null && Number.isFinite(maxSqftRaw) && maxSqftRaw > 0
        ? Math.floor(maxSqftRaw)
        : null;
    const city = String(req.city || "").trim().slice(0, 120) || null;
    const state = String(req.state || "").trim().slice(0, 80) || null;
    const neighborhood = String(req.neighborhood || "").trim().slice(0, 160) || null;
    const campusWithinRaw =
      req.campus_within_miles != null && req.campus_within_miles !== ""
        ? Number(req.campus_within_miles)
        : null;
    const campusWithinMiles =
      campusWithinRaw != null && Number.isFinite(campusWithinRaw) && campusWithinRaw > 0
        ? Math.min(50, campusWithinRaw)
        : null;

    const { sql, params } = buildListingsSearchQuery({
      q,
      minP: minP != null && !Number.isNaN(minP) ? minP : null,
      maxP: maxP != null && !Number.isNaN(maxP) ? maxP : null,
      smoke,
      pets,
      furnished,
      amenitySlugs,
      newWithin,
      sort,
      limit,
      offset,
      residenceTypes,
      minSqft,
      maxSqft,
      city,
      state,
      neighborhood,
      campusWithinMiles,
    });

    pool
      .query(sql, params)
      .then((res) => {
        logGrpcTiming("SearchListings", start);
        const uniqueRows = dedupeListingsById(
          res.rows as Record<string, unknown>[],
        );
        callback(null, { listings: uniqueRows.map((r) => rowToResponse(r)) });
      })
      .catch((e) => {
        console.error("[SearchListings]", e);
        logGrpcTiming("SearchListings", start);
        callback({ code: grpc.status.INTERNAL, message: "search failed" });
      });
  },
};

export async function listingsGrpcHealthCheckForTest(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

function createListingsGrpcServerCredentials(): grpc.ServerCredentials {
  try {
    return createOchGrpcServerCredentialsForBind("listings gRPC");
  } catch (e) {
    console.error(e);
    process.exit(1);
    throw e;
  }
}

function buildListingsGrpcServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(
    listingsProto.listings.ListingsService.service,
    listingsGrpcHandlersForTest,
  );

  registerHealthService(
    server,
    "listings.ListingsService",
    listingsGrpcHealthCheckForTest,
  );

  return server;
}

export function startGrpcServer(port: number): grpc.Server {
  const server = buildListingsGrpcServer();
  const credentials = createListingsGrpcServerCredentials();

  server.bindAsync(
    `0.0.0.0:${port}`,
    credentials,
    (err: Error | null, boundPort: number) => {
      if (err) {
        console.error("[listings gRPC] bind error:", err);
        return;
      }
      console.log(`[listings gRPC] listening on ${boundPort}`);
    },
  );

  return server;
}

/** Resolves after successful `bindAsync` (for integration tests). */
export function startGrpcServerAndWait(port: number): Promise<grpc.Server> {
  const server = buildListingsGrpcServer();
  const credentials = createListingsGrpcServerCredentials();

  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      credentials,
      (err: Error | null, boundPort: number) => {
        if (err) {
          console.error("[listings gRPC] bind error:", err);
          reject(err);
          return;
        }
        console.log(`[listings gRPC] listening on ${boundPort}`);
        resolve(server);
      },
    );
  });
}
