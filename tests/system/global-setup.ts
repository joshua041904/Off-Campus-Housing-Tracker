import { ochKafkaTopicIsolationSuffix } from "@common/utils";
import { ensureVitestClusterKafkaTopic } from "@common/utils/kafka-vitest-cluster";

/**
 * Ensure listing events topic exists for system contract tests (same naming as listings + analytics consumer).
 */
export default async function systemGlobalSetup(): Promise<void> {
  if (
    process.env.SKIP_SYSTEM_CONTRACTS === "1" ||
    process.env.SKIP_SYSTEM_CONTRACTS === "true"
  ) {
    return;
  }
  const prefix = process.env.ENV_PREFIX || "dev";
  const topic =
    process.env.LISTING_EVENTS_TOPIC?.trim() ||
    `${prefix}.listing.events${ochKafkaTopicIsolationSuffix()}`;
  await ensureVitestClusterKafkaTopic(topic);
}
