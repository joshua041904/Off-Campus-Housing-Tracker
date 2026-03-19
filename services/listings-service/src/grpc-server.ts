import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  CreateListing(call: any, callback: any) {
    const req = call.request;

    callback(null, {
      listing_id: "temp-id",
      user_id: req.user_id,
      title: req.title,
      description: req.description,
      price_cents: req.price_cents,
      amenities: req.amenities ?? [],
      smoke_free: req.smoke_free,
      pet_friendly: req.pet_friendly,
      furnished: req.furnished,
      status: "active",
      created_at: new Date().toISOString(),
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
