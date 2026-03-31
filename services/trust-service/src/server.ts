import "dotenv/config";
import { warmupTrustDb } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { startTrustHttpServer } from "./http-server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4016");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50066");

startTrustHttpServer(HTTP_PORT);
startGrpcServer(GRPC_PORT);
void warmupTrustDb().catch((err) => {
  console.error("[trust-service] DB warmup failed (non-fatal)", err);
});
