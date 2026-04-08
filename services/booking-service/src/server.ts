import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { startBookingUserLifecycleConsumer } from "./user-lifecycle-consumer.js";
import { prisma } from "./lib/prisma.js";
import { BOOKING_EVENTS_TOPIC, startGrpcServer } from "./grpc-server.js";
import { userLifecycleV1Topic } from "@common/utils";
import { createBookingHttpApp, disconnectBookingHttpKafkaProducer } from "./http-app.js";

const HTTP_PORT = Number(process.env.HTTP_PORT || "4013");
const GRPC_PORT = Number(process.env.GRPC_PORT || "50063");

async function main() {
  await ensureKafkaBrokerReady("booking-service", {
    requiredTopics: [BOOKING_EVENTS_TOPIC, userLifecycleV1Topic()],
  });
  const app = createBookingHttpApp();
  app.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`[booking] HTTP server listening on port ${HTTP_PORT}`);
  });
  startGrpcServer(GRPC_PORT);
  setImmediate(() => {
    void startBookingUserLifecycleConsumer().catch((e) =>
      console.error("[booking-service] user lifecycle consumer:", e),
    );
  });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  try {
    await disconnectBookingHttpKafkaProducer();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
