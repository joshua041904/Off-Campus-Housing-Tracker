import "dotenv/config";
import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { startGrpcServer } from "./grpc-server.js";
import { startNotificationHttpServer } from "./http-server.js";
import { pool } from "./db.js";
import { notificationKafkaTopics, startNotificationConsumer } from "./kafka-consumer.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4015");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50065");

async function main() {
  await ensureKafkaBrokerReady("notification-service", { requiredTopics: notificationKafkaTopics() });
  startNotificationHttpServer(HTTP_PORT);
  startGrpcServer(GRPC_PORT);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Defer Kafka consumer so HTTP+gRPC listeners register first.
setImmediate(() => {
  void startNotificationConsumer(pool).then((c) => {
    if (c) {
      const shutdown = async () => {
        try {
          await c.disconnect();
        } catch {
          /* ignore */
        }
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    }
  });
});
