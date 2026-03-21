import "dotenv/config";
import { startGrpcServer } from "./grpc-server.js";
import { startAnalyticsHttpServer } from "./http-server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4017");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50067");

startAnalyticsHttpServer(HTTP_PORT);
startGrpcServer(GRPC_PORT);
