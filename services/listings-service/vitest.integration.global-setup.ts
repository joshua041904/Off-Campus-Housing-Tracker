import { ensureKafkaBrokerReady } from "@common/utils/kafka";
import { LISTING_EVENTS_TOPIC } from "./src/listing-kafka.js";
import { applyIntegrationKafkaTlsEnv } from "./vitest.integration.kafka-env.js";

export default async function globalSetup(): Promise<void> {
  applyIntegrationKafkaTlsEnv();
  // CI PLAINTEXT (GitHub services): broker is up; topics are auto-created on first publish.
  const plaintext =
    process.env.KAFKA_SSL_ENABLED === "false" || process.env.CI_KAFKA_PLAINTEXT === "1";
  await ensureKafkaBrokerReady(
    "vitest-listings-integration",
    plaintext ? undefined : { requiredTopics: [LISTING_EVENTS_TOPIC] },
  );
}
