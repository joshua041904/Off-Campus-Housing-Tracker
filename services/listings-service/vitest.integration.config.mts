import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyVitestClusterKafkaBrokerEnv } from "@common/utils/kafka-vitest-cluster";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
applyVitestClusterKafkaBrokerEnv(repoRoot);

const topicSuffix =
  process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim() ||
  process.env.GITHUB_RUN_ID?.trim() ||
  `local-${process.pid}-${Date.now()}`;
process.env.OCH_KAFKA_TOPIC_SUFFIX = topicSuffix;

const env: Record<string, string> = {
  OCH_GRPC_INSECURE_TEST_BIND: "1",
  KAFKA_BROKER: process.env.KAFKA_BROKER!,
  KAFKA_SSL_ENABLED: process.env.KAFKA_SSL_ENABLED!,
  OCH_KAFKA_TOPIC_SUFFIX: topicSuffix,
  POSTGRES_URL_LISTINGS:
    process.env.POSTGRES_URL_LISTINGS ?? "postgresql://postgres:postgres@127.0.0.1:5442/listings",
  ANALYTICS_SYNC_MODE: process.env.ANALYTICS_SYNC_MODE ?? "0",
  LISTINGS_KAFKA_AWAIT_PUBLISH: process.env.LISTINGS_KAFKA_AWAIT_PUBLISH ?? "1",
  KAFKA_CONNECT_TIMEOUT_MS: process.env.KAFKA_CONNECT_TIMEOUT_MS ?? "15000",
  KAFKAJS_METADATA_RETRIES: process.env.KAFKAJS_METADATA_RETRIES ?? "8",
  KAFKAJS_NO_PARTITIONER_WARNING: process.env.KAFKAJS_NO_PARTITIONER_WARNING ?? "1",
};
for (const k of ["KAFKA_CA_CERT", "KAFKA_CLIENT_CERT", "KAFKA_CLIENT_KEY", "KAFKA_SSL_SKIP_HOSTNAME_CHECK"] as const) {
  const v = process.env[k];
  if (v) env[k] = v;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    globalSetup: ["./vitest.integration.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/generated/**",
        "**/*.d.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
    server: {
      deps: {
        inline: ["kafkajs"],
      },
    },
    env,
  },
});
