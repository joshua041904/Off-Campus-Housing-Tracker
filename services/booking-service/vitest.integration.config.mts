import { defineConfig } from "vitest/config";
import { applyBookingIntegrationKafkaBrokerEnv } from "./vitest.integration.kafka-env.js";

applyBookingIntegrationKafkaBrokerEnv();

const topicSuffix =
  process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim() ||
  process.env.GITHUB_RUN_ID?.trim() ||
  `booking-it-${process.pid}-${Date.now()}`;
process.env.OCH_KAFKA_TOPIC_SUFFIX = topicSuffix;

const kb = process.env.KAFKA_BROKER!.trim();
const env: Record<string, string> = {
  KAFKA_BROKER: kb,
  KAFKA_SSL_ENABLED: process.env.KAFKA_SSL_ENABLED!,
  OCH_KAFKA_TOPIC_SUFFIX: topicSuffix,
  KAFKA_CONNECT_TIMEOUT_MS: process.env.KAFKA_CONNECT_TIMEOUT_MS ?? "3000",
  KAFKAJS_CONNECTION_TIMEOUT_MS: process.env.KAFKAJS_CONNECTION_TIMEOUT_MS ?? "3000",
  KAFKAJS_METADATA_RETRIES: process.env.KAFKAJS_METADATA_RETRIES ?? "2",
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
    testTimeout: 60_000,
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
    globalSetup: ["./vitest.integration.global-setup.ts"],
    server: {
      deps: {
        inline: ["kafkajs"],
      },
    },
    env,
  },
});
