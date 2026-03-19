import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.resolve(__dirname, "../../../proto/listings.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const listingsProto = grpc.loadPackageDefinition(packageDefinition) as any;

const listingsService = {
  // CreateListing should:
  // validate input
  // insert a row into listings.listings
  // return a real ListingResponse
  CreateListing(call: any, callback: any) {
    const req = call.request;
    // Basic validation: check required fields and price > 0
    if (
      !req.user_id ||
      !req.title ||
      !req.effective_from ||
      req.price_cents <= 0
    ) {
      callback({
        code: grpc.status.INVALID_ARGUMENT,
        message:
          "user_id, title, effective_from, and positive price_cents are required",
      });
      return;
    }

    // Insert the new listing into the database
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
        $1,
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

    // Convert amenities array to JSON string for storage
    const values = [
      req.user_id,
      req.title,
      req.description || "",
      req.price_cents,
      JSON.stringify(req.amenities ?? []),
      req.smoke_free,
      req.pet_friendly,
      req.furnished,
      req.effective_from,
      req.effective_until || "",
    ];

    // Execute the query and handle the result
    pool
      .query(query, values)
      .then((result) => {
        const row = result.rows[0];

        // Return the created listing in the response
        callback(null, {
          listing_id: row.id,
          user_id: row.user_id,
          title: row.title ?? "",
          description: row.description ?? "",
          price_cents: row.price_cents,
          amenities: row.amenities ?? [],
          smoke_free: row.smoke_free,
          pet_friendly: row.pet_friendly,
          furnished: row.furnished ?? false,
          status: row.status,
          created_at: new Date(row.created_at).toISOString(),
        });
      })
      .catch((error) => {
        console.error("CreateListing DB error:", error);
        callback({
          code: grpc.status.INTERNAL,
          message: "failed to create listing",
        });
      });
  },

  GetListing(call: any, callback: any) {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: "GetListing not implemented yet",
    });
  },

  SearchListings(call: any, callback: any) {
    callback({
      code: grpc.status.UNIMPLEMENTED,
      message: "SearchListings not implemented yet",
    });
  },
};

export function startGrpcServer(port: number = 50052) {
  const server = new grpc.Server();

  server.addService(listingsProto.listings.ListingsService.service, {
    CreateListing: listingsService.CreateListing,
    GetListing: listingsService.GetListing,
    SearchListings: listingsService.SearchListings,
  });

  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (error, actualPort) => {
      if (error) {
        console.error("Server bind error:", error);
        return;
      }
      console.log(`listing-service gRPC server started on port ${actualPort}`);
    },
  );

  return server;
}
