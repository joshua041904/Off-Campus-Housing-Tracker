import "dotenv/config";
import { startGrpcServer } from "./grpc-server.js";
import { startNotificationHttpServer } from "./http-server.js";
import { pool } from "./db.js";
import { startNotificationConsumer } from "./kafka-consumer.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4015");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50065");

startNotificationHttpServer(HTTP_PORT);
startGrpcServer(GRPC_PORT);

// Defer Kafka consumer so HTTP+gRPC listeners register first; Kafka downtime must not block the event loop during boot.
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
