import { applyIntegrationKafkaTlsEnv } from "./vitest.integration.kafka-env.js";

export default async function globalSetup(): Promise<void> {
  applyIntegrationKafkaTlsEnv();
  const { LISTING_EVENTS_TOPIC } = await import("./listing-kafka.js");
  const { ensureKafkaBrokerReady } = await import("@common/utils/kafka");
  await ensureKafkaBrokerReady("vitest-listings-integration", { requiredTopics: [LISTING_EVENTS_TOPIC] });
}
