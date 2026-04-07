#!/usr/bin/env node
/**
 * Fail-fast gate before listings/booking Vitest integration (pnpm run test:integration:all).
 * Enforces: ≥3 unique broker seeds, TLS + PEM files on disk, no localhost / :29092, no CI_KAFKA_PLAINTEXT.
 * Discovers MetalLB brokers when OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 (same as @common/utils/kafka-vitest-cluster).
 *
 * Skip (e.g. CI without cluster): OCH_SKIP_KAFKA_INTEGRATION_ASSERT=1
 *
 * Requires: pnpm -C services/common run build
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

if (process.env.OCH_SKIP_KAFKA_INTEGRATION_ASSERT === "1" || process.env.OCH_SKIP_KAFKA_INTEGRATION_ASSERT === "true") {
  console.warn("[och-it] assert-kafka-integration-cluster: skipped (OCH_SKIP_KAFKA_INTEGRATION_ASSERT=1)");
  process.exit(0);
}

const distPath = join(repoRoot, "services/common/dist/kafka-vitest-cluster.js");
if (!existsSync(distPath)) {
  console.error("[och-it] Missing services/common/dist/kafka-vitest-cluster.js — run: pnpm -C services/common run build");
  process.exit(1);
}

process.env.OCH_INTEGRATION_KAFKA_FROM_K8S_LB ??= "1";
process.env.BOOKING_IT_KAFKA_FROM_K8S_LB ??= "1";

const { assertVitestKafkaClusterIntegrationPolicy } = await import(distPath);
try {
  assertVitestKafkaClusterIntegrationPolicy(repoRoot);
  console.log("[och-it] Kafka cluster integration policy OK (≥3 TLS seeds, PEM material, no plaintext shortcuts).");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
}
