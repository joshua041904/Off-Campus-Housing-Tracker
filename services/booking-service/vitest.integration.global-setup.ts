import { ensureBookingIntegrationKafkaTopics } from "./vitest.integration.kafka-topics-bootstrap.js";

/** Cluster TLS + topic ensure before tests. */
export default async function globalSetup(): Promise<void> {
  await ensureBookingIntegrationKafkaTopics();
}
