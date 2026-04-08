/**
 * Booking integration Kafka env — delegates to `@common/utils/kafka-vitest-cluster`.
 * See monorepo docs / booking README for OCH_INTEGRATION_KAFKA_FROM_K8S_LB and TLS layout.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyVitestClusterKafkaBrokerEnv,
  countKafkaBrokerSeeds as countSeeds,
  resolveKafkaTlsMaterialDir as resolveTlsFromRoot,
} from "@common/utils/kafka-vitest-cluster";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveKafkaTlsMaterialDir(): string | null {
  return resolveTlsFromRoot(repoRoot);
}

export { countSeeds as countKafkaBrokerSeeds };

/** Same three-seed bootstrap as infra/k8s/base/config/app-config.yaml (in-cluster DNS + TLS :9093). */
export const BOOKING_IT_DEFAULT_CLUSTER_BOOTSTRAP_SSL =
  "kafka-0.kafka.off-campus-housing-tracker.svc.cluster.local:9093,kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local:9093,kafka-2.kafka.off-campus-housing-tracker.svc.cluster.local:9093";

export function applyBookingIntegrationKafkaBrokerEnv(): void {
  applyVitestClusterKafkaBrokerEnv(repoRoot);
}
