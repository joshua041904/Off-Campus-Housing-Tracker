import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * System contract Vitest config.
 *
 * SKIP_SYSTEM_CONTRACTS=1 must never load `@common/utils/kafka-vitest-cluster` (it pulls in `kafka.js`).
 * Use dynamic import only on the real cluster path.
 */
export default defineConfig(async () => {
  const repoRoot =
    process.env.OCH_REPO_ROOT?.trim() ||
    dirname(fileURLToPath(import.meta.url));

  const skip =
    process.env.SKIP_SYSTEM_CONTRACTS === "1" ||
    process.env.SKIP_SYSTEM_CONTRACTS === "true";

  process.env.POSTGRES_URL_ANALYTICS ??=
    "postgresql://postgres:postgres@127.0.0.1:5447/analytics";
  process.env.ENV_PREFIX ??= "dev";
  /** Central idempotency: unique topic + group every run (no collision with prod suffixes or other devs). */
  process.env.OCH_KAFKA_TOPIC_SUFFIX = `.sys-${process.pid}-${Date.now()}`;
  process.env.KAFKAJS_CONNECTION_TIMEOUT_MS ??= "15000";
  process.env.KAFKAJS_METADATA_RETRIES ??= "8";
  process.env.KAFKAJS_NO_PARTITIONER_WARNING ??= "1";
  /** Isolated group — must not join `analytics-service-listing-events` with running analytics pods. */
  const suffixClean = process.env.OCH_KAFKA_TOPIC_SUFFIX.replace(/^\.+/u, "").replace(/[^a-zA-Z0-9_.-]/gu, "-");
  process.env.ANALYTICS_LISTING_KAFKA_GROUP ??= `och-sys-contract-${suffixClean}`;

  if (skip) {
    process.env.KAFKA_BROKER = "dummy1:9094,dummy2:9094,dummy3:9094";
    process.env.KAFKA_SSL_ENABLED = "false";
    delete process.env.CI_KAFKA_PLAINTEXT;
  } else {
    const { applyVitestClusterKafkaBrokerEnv } = await import(
      "@common/utils/kafka-vitest-cluster"
    );
    applyVitestClusterKafkaBrokerEnv(repoRoot);
  }

  const env: Record<string, string> = {
    KAFKA_BROKER: process.env.KAFKA_BROKER!,
    KAFKA_SSL_ENABLED: process.env.KAFKA_SSL_ENABLED!,
    ENV_PREFIX: process.env.ENV_PREFIX || "dev",
    OCH_KAFKA_TOPIC_SUFFIX: process.env.OCH_KAFKA_TOPIC_SUFFIX!,
    POSTGRES_URL_ANALYTICS: process.env.POSTGRES_URL_ANALYTICS!,
    ANALYTICS_LISTING_KAFKA_CONSUMER: process.env.ANALYTICS_LISTING_KAFKA_CONSUMER ?? "1",
    ANALYTICS_LISTING_KAFKA_GROUP: process.env.ANALYTICS_LISTING_KAFKA_GROUP!,
    KAFKAJS_CONNECTION_TIMEOUT_MS: process.env.KAFKAJS_CONNECTION_TIMEOUT_MS ?? "15000",
    KAFKAJS_METADATA_RETRIES: process.env.KAFKAJS_METADATA_RETRIES ?? "8",
    KAFKAJS_NO_PARTITIONER_WARNING: process.env.KAFKAJS_NO_PARTITIONER_WARNING ?? "1",
  };
  for (const k of ["KAFKA_CA_CERT", "KAFKA_CLIENT_CERT", "KAFKA_CLIENT_KEY", "KAFKA_SSL_SKIP_HOSTNAME_CHECK"] as const) {
    const v = process.env[k];
    if (v) env[k] = v;
  }

  return {
    test: {
      environment: "node",
      include: ["tests/system/**/*.test.ts"],
      passWithNoTests: false,
      testTimeout: 120_000,
      hookTimeout: 120_000,
      globalSetup: ["./tests/system/global-setup.ts"],
      server: {
        deps: {
          inline: ["kafkajs", "@common/utils"],
        },
      },
      env,
    },
  };
});
