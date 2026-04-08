import { ochKafkaTopicIsolationSuffix } from "@common/utils";
import { ensureVitestClusterKafkaTopic } from "@common/utils/kafka-vitest-cluster";

export async function ensureBookingIntegrationKafkaTopics(): Promise<void> {
  const topic =
    process.env.BOOKING_EVENTS_TOPIC?.trim() || `dev.booking.events.v1${ochKafkaTopicIsolationSuffix()}`;
  await ensureVitestClusterKafkaTopic(topic);
}
