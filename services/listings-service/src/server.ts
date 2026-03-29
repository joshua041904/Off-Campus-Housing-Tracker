import "dotenv/config";
import { startGrpcServer } from "./grpc-server.js";
import { startListingsHttpServer } from "./http-server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4012");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50062");

console.log("[listings-service] Analytics mode:", process.env.ANALYTICS_SYNC_MODE ?? "(unset)");

startListingsHttpServer(HTTP_PORT);
startGrpcServer(GRPC_PORT);
