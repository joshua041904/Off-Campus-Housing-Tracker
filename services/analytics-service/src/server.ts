import "dotenv/config";
import { startListingEventsConsumer } from "./consumers/listingEventsConsumer.js";
import { pool } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { startAnalyticsHttpServer } from "./http-server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4017");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50067");

startAnalyticsHttpServer(HTTP_PORT);
startGrpcServer(GRPC_PORT);
void startListingEventsConsumer(pool).catch((e) => console.error("[analytics] listing events consumer:", e));
