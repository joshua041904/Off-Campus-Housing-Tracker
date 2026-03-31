import "dotenv/config";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { LISTING_EVENTS_TOPIC } from "./listing-kafka.js";
import { startGrpcServer } from "./grpc-server.js";
import { startListingsHttpServer } from "./http-server.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4012");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50062");

async function main() {
  await ensureKafkaBrokerReady("listings-service", { requiredTopics: [LISTING_EVENTS_TOPIC] });
  console.log("[listings-service] Analytics mode:", process.env.ANALYTICS_SYNC_MODE ?? "(unset)");
  startListingsHttpServer(HTTP_PORT);
  startGrpcServer(GRPC_PORT);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
