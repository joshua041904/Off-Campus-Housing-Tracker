import { ochKafkaTopicIsolationSuffix } from "@common/utils";
import { ensureVitestClusterKafkaTopic } from "@common/utils/kafka-vitest-cluster";

const ENV_PREFIX = process.env.ENV_PREFIX || "dev";
const listingEventsTopic =
  process.env.LISTING_EVENTS_TOPIC?.trim() ||
  `${ENV_PREFIX}.listing.events${ochKafkaTopicIsolationSuffix()}`;

export default async function globalSetup(): Promise<void> {
  await ensureVitestClusterKafkaTopic(listingEventsTopic);
}
