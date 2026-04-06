import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { resolveKafkaTlsMaterialDir } from "./vitest.integration.kafka-env.js";

const topicSuffix =
  process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim() ||
  process.env.GITHUB_RUN_ID?.trim() ||
  `local-${process.pid}-${Date.now()}`;

// globalSetup runs in the same Vitest process; test.env alone does not set process.env for listing-kafka.
process.env.OCH_KAFKA_TOPIC_SUFFIX = topicSuffix;

const plaintextCi =
  process.env.KAFKA_SSL_ENABLED === "false" || process.env.CI_KAFKA_PLAINTEXT === "1";
const tlsDir = plaintextCi ? null : resolveKafkaTlsMaterialDir();
const kafkaTlsEnv =
  tlsDir != null
    ? {
        KAFKA_SSL_ENABLED: process.env.KAFKA_SSL_ENABLED ?? "true",
        KAFKA_BROKER: process.env.KAFKA_BROKER ?? "127.0.0.1:29094",
        KAFKA_CA_CERT: process.env.KAFKA_CA_CERT ?? join(tlsDir, "ca-cert.pem"),
        KAFKA_CLIENT_CERT: process.env.KAFKA_CLIENT_CERT ?? join(tlsDir, "client.crt"),
        KAFKA_CLIENT_KEY: process.env.KAFKA_CLIENT_KEY ?? join(tlsDir, "client.key"),
      }
    : plaintextCi
      ? {
          KAFKA_SSL_ENABLED: "false",
          CI_KAFKA_PLAINTEXT: process.env.CI_KAFKA_PLAINTEXT ?? "1",
          KAFKA_BROKER: process.env.KAFKA_BROKER ?? "127.0.0.1:9092",
        }
      : {};

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.integration.test.ts"],
    globalSetup: ["./vitest.integration.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      OCH_GRPC_INSECURE_TEST_BIND: "1",
      ...kafkaTlsEnv,
      OCH_KAFKA_TOPIC_SUFFIX: topicSuffix,
      POSTGRES_URL_LISTINGS:
        process.env.POSTGRES_URL_LISTINGS ??
        "postgresql://postgres:postgres@127.0.0.1:5442/listings",
      ANALYTICS_SYNC_MODE: process.env.ANALYTICS_SYNC_MODE ?? "0",
      /** Integration tests expect awaitable publish / failures surfaced in-process. */
      LISTINGS_KAFKA_AWAIT_PUBLISH: process.env.LISTINGS_KAFKA_AWAIT_PUBLISH ?? "1",
      KAFKA_CONNECT_TIMEOUT_MS: process.env.KAFKA_CONNECT_TIMEOUT_MS ?? "15000",
      KAFKAJS_METADATA_RETRIES: process.env.KAFKAJS_METADATA_RETRIES ?? "8",
    },
  },
});
