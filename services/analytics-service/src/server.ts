import "dotenv/config";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import {
  ANALYTICS_LISTING_EVENTS_TOPIC,
  startListingEventsConsumer,
} from "./consumers/listingEventsConsumer.js";
import { pool } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { startAnalyticsHttpServer } from "./http-server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4017");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50067");

async function main() {
  await ensureKafkaBrokerReady("analytics-service", { requiredTopics: [ANALYTICS_LISTING_EVENTS_TOPIC] });
  startAnalyticsHttpServer(HTTP_PORT);
  startGrpcServer(GRPC_PORT);
  void startListingEventsConsumer(pool).catch((e) => console.error("[analytics] listing events consumer:", e));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
