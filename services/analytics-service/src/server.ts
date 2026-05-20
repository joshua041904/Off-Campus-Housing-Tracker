import "./otel-bootstrap.js";
import "dotenv/config";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import {
  ANALYTICS_LISTING_EVENTS_TOPIC,
  startListingEventsConsumer,
} from "./consumers/listingEventsConsumer.js";
import { pool } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { startAnalyticsHttpServer } from "./http-server.js";
import { startSkewGaugePoller } from "./intelligence/analyticsUnifiedObservabilityMetrics.js";
import { startAiControlPlaneController } from "./intelligence/aiControlPlaneController.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4017");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50067");

async function main() {
  const requireKafkaStartup = process.env.ANALYTICS_STARTUP_REQUIRE_KAFKA !== "0";
  if (requireKafkaStartup) {
    await ensureKafkaBrokerReady("analytics-service", { requiredTopics: [ANALYTICS_LISTING_EVENTS_TOPIC] });
  } else {
    console.warn(
      "[analytics] ANALYTICS_STARTUP_REQUIRE_KAFKA=0 — skipping Kafka startup barrier (HTTP serves; listing-events consumer may still fail)",
    );
  }
  startSkewGaugePoller();
  startAiControlPlaneController();
  await startAnalyticsHttpServer(HTTP_PORT);
  startGrpcServer(GRPC_PORT);
  // Ollama Deployment already warms the model; a second /api/generate here can abort mid-load if timed out.
  void startListingEventsConsumer(pool).catch((e) => console.error("[analytics] listing events consumer:", e));
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
