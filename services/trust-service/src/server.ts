import "dotenv/config";
import { userLifecycleV1Topic } from "@common/utils";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { warmupTrustDb } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { startTrustHttpServer } from "./http-server.js";
import { startTrustUserLifecycleConsumer } from "./user-lifecycle-consumer.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4016");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50066");

async function main() {
  await ensureKafkaBrokerReady("trust-service", { requiredTopics: [userLifecycleV1Topic()] });
  startTrustHttpServer(HTTP_PORT);
  startGrpcServer(GRPC_PORT);
  void warmupTrustDb().catch((err) => {
    console.error("[trust-service] DB warmup failed (non-fatal)", err);
  });
  setImmediate(() => {
    void startTrustUserLifecycleConsumer().catch((e) =>
      console.error("[trust-service] user lifecycle consumer:", e),
    );
  });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
