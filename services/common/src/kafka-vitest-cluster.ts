/**
 * Shared Vitest integration Kafka: **cluster-only** (≥3 TLS seeds, MetalLB :9094 or explicit KAFKA_BROKER).
 * Used by booking-service, listings-service, and any future HTTP/gRPC integration that talks to real Kafka.
 *
 * Env:
 *   - OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 — discover kafka-{0,1,2}-external LoadBalancer IPs (alias: BOOKING_IT_KAFKA_FROM_K8S_LB=1)
 *   - OCH_INTEGRATION_KAFKA_BROKERS / BOOKING_IT_KAFKA_BROKERS — optional multi-seed string copied to KAFKA_BROKER
 *   - OCH_INTEGRATION_K8S_NAMESPACE / BOOKING_IT_K8S_NAMESPACE / HOUSING_NS — kubectl namespace (default off-campus-housing-tracker)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Kafka, type Admin } from "kafkajs";
import { getKafkaSslConfigForTest } from "./kafka.js";

const DEFAULT_TOPIC_PARTITIONS = 3;
const DEFAULT_TOPIC_REPLICATION = 3;
/** Minimum in-sync replica *assignment* count per partition (integration / system policy). */
const MIN_TOPIC_REPLICATION_ENFORCED = 3;

/**
 * Hard policy: ≥3 unique broker seeds, no loopback, no typical plaintext compose port.
 * Call after `KAFKA_BROKER` is fully resolved (explicit or MetalLB).
 */
export function enforceClusterKafkaBrokerSeedPolicy(brokerCsv: string): void {
  const seeds = brokerCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (seeds.length < MIN_TOPIC_REPLICATION_ENFORCED) {
    throw new Error(
      `[och-it] Integration requires >=${MIN_TOPIC_REPLICATION_ENFORCED} Kafka broker seeds (MetalLB TLS cluster only); got ${seeds.length}.`,
    );
  }
  if (new Set(seeds).size !== seeds.length) {
    throw new Error("[och-it] Duplicate Kafka broker seeds are not allowed.");
  }
  for (const seed of seeds) {
    if (/127\.0\.0\.1/i.test(seed) || /localhost/i.test(seed) || /\[::1\]/i.test(seed) || /\b::1\b/.test(seed)) {
      throw new Error(`[och-it] Localhost / loopback Kafka brokers are forbidden for integration: ${seed}`);
    }
    if (/:29092\b/.test(seed)) {
      throw new Error(`[och-it] Port 29092 (host-compose plaintext) is forbidden for cluster integration: ${seed}`);
    }
  }
}

function enforceTlsPemFilesExistOnDisk(): void {
  const ca = process.env.KAFKA_CA_CERT?.trim() || process.env.KAFKA_SSL_CA_PATH?.trim();
  const cert = process.env.KAFKA_CLIENT_CERT?.trim() || process.env.KAFKA_SSL_CERT_PATH?.trim();
  const key = process.env.KAFKA_CLIENT_KEY?.trim() || process.env.KAFKA_SSL_KEY_PATH?.trim();
  if (!ca || !cert || !key) {
    throw new Error(
      "[och-it] TLS requires KAFKA_CA_CERT (or KAFKA_SSL_CA_PATH), KAFKA_CLIENT_CERT (or KAFKA_SSL_CERT_PATH), KAFKA_CLIENT_KEY (or KAFKA_SSL_KEY_PATH) pointing at PEM files on disk.",
    );
  }
  for (const [label, p] of [
    ["CA", ca],
    ["client certificate", cert],
    ["client key", key],
  ] as const) {
    if (!existsSync(p)) {
      throw new Error(`[och-it] Missing TLS PEM file (${label}): ${p}`);
    }
  }
}

async function assertTopicMinReplicationFactor(
  admin: Admin,
  topicName: string,
  minRf: number,
): Promise<void> {
  const { topics } = await admin.fetchTopicMetadata({ topics: [topicName] });
  const t = topics.find((x) => x.name === topicName);
  if (!t) {
    throw new Error(`[och-it] fetchTopicMetadata: topic "${topicName}" not in metadata`);
  }
  for (const p of t.partitions) {
    const n = p.replicas?.length ?? 0;
    if (n < minRf) {
      throw new Error(
        `[och-it] Topic "${topicName}" partition ${p.partitionId} has replica assignment count ${n}; require >= ${minRf} (refusing RF=1 / under-replicated test topics).`,
      );
    }
  }
}

export function resolveKafkaTlsMaterialDir(repoRoot: string): string | null {
  const ci = join(repoRoot, "certs", "kafka-ssl-ci");
  const dev = join(repoRoot, "certs", "kafka-ssl");
  if (existsSync(join(ci, "ca-cert.pem"))) return ci;
  if (existsSync(join(dev, "ca-cert.pem"))) return dev;
  return null;
}

export function countKafkaBrokerSeeds(brokerList: string): number {
  return brokerList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/** True when MetalLB discovery is requested (legacy booking flag included). */
export function integrationKafkaFromK8sLbFlag(): boolean {
  return (
    process.env.OCH_INTEGRATION_KAFKA_FROM_K8S_LB === "1" ||
    process.env.BOOKING_IT_KAFKA_FROM_K8S_LB === "1"
  );
}

function kubectlLbIngress(service: string, namespace: string): string {
  try {
    const ip = execFileSync(
      "kubectl",
      ["get", "svc", service, "-n", namespace, "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}"],
      { encoding: "utf8", maxBuffer: 256 * 1024 },
    ).trim();
    if (ip) return ip;
    return execFileSync(
      "kubectl",
      ["get", "svc", service, "-n", namespace, "-o", "jsonpath={.status.loadBalancer.ingress[0].hostname}"],
      { encoding: "utf8", maxBuffer: 256 * 1024 },
    ).trim();
  } catch {
    return "";
  }
}

function k8sNamespace(): string {
  return (
    process.env.OCH_INTEGRATION_K8S_NAMESPACE?.trim() ||
    process.env.BOOKING_IT_K8S_NAMESPACE?.trim() ||
    process.env.HOUSING_NS?.trim() ||
    "off-campus-housing-tracker"
  );
}

function applyTlsPathsFromRepo(repoRoot: string): void {
  const tlsDir = resolveKafkaTlsMaterialDir(repoRoot);
  if (!tlsDir) {
    throw new Error(
      "[och-it] TLS required: set KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY or add ca-cert.pem + client.crt + client.key under certs/kafka-ssl/ or certs/kafka-ssl-ci/.",
    );
  }
  process.env.KAFKA_CA_CERT ??= join(tlsDir, "ca-cert.pem");
  process.env.KAFKA_CLIENT_CERT ??= join(tlsDir, "client.crt");
  process.env.KAFKA_CLIENT_KEY ??= join(tlsDir, "client.key");
}

function ensureTlsConfigured(repoRoot: string): void {
  if (
    process.env.KAFKA_CA_CERT?.trim() &&
    process.env.KAFKA_CLIENT_CERT?.trim() &&
    process.env.KAFKA_CLIENT_KEY?.trim()
  ) {
    return;
  }
  applyTlsPathsFromRepo(repoRoot);
}

function validateExplicitBrokerList(repoRoot: string, brokers: string): void {
  if (process.env.KAFKA_SSL_ENABLED === "false") {
    throw new Error("[och-it] Plaintext Kafka is forbidden for cluster integration / system tests (KAFKA_SSL_ENABLED=false).");
  }
  enforceClusterKafkaBrokerSeedPolicy(brokers);
  process.env.KAFKA_SSL_ENABLED = "true";
  ensureTlsConfigured(repoRoot);
  enforceTlsPemFilesExistOnDisk();
  process.env.KAFKA_SSL_SKIP_HOSTNAME_CHECK ??= "1";
  delete process.env.CI_KAFKA_PLAINTEXT;
}

function applyKafkaBootstrapFromK8sExternalLbs(repoRoot: string): void {
  const ns = k8sNamespace();
  const ips = [0, 1, 2].map((i) => kubectlLbIngress(`kafka-${i}-external`, ns)).filter(Boolean);
  if (ips.length !== 3) {
    throw new Error(
      `[och-it] Expected 3 Kafka external LoadBalancer endpoints (kafka-0/1/2-external) in namespace "${ns}"; got ${ips.length}. Check: kubectl get svc -n ${ns} kafka-0-external kafka-1-external kafka-2-external`,
    );
  }
  const tlsDir = resolveKafkaTlsMaterialDir(repoRoot);
  if (!tlsDir) {
    throw new Error(
      "[och-it] MetalLB bootstrap requires certs under certs/kafka-ssl/ or certs/kafka-ssl-ci/ (ca-cert.pem, client.crt, client.key).",
    );
  }
  process.env.KAFKA_SSL_ENABLED = "true";
  process.env.KAFKA_SSL_SKIP_HOSTNAME_CHECK ??= "1";
  process.env.KAFKA_BROKER = `${ips[0]}:9094,${ips[1]}:9094,${ips[2]}:9094`;
  enforceClusterKafkaBrokerSeedPolicy(process.env.KAFKA_BROKER);
  process.env.KAFKA_CA_CERT ??= join(tlsDir, "ca-cert.pem");
  process.env.KAFKA_CLIENT_CERT ??= join(tlsDir, "client.crt");
  process.env.KAFKA_CLIENT_KEY ??= join(tlsDir, "client.key");
  enforceTlsPemFilesExistOnDisk();
  delete process.env.CI_KAFKA_PLAINTEXT;
}

/**
 * Set process.env KAFKA_BROKER / TLS for Vitest **before** workers import @common/utils kafka singleton.
 * @param repoRoot — monorepo root (directory containing certs/)
 */
export function applyVitestClusterKafkaBrokerEnv(repoRoot: string): void {
  if (process.env.CI_KAFKA_PLAINTEXT?.trim()) {
    throw new Error(
      "[och-it] CI_KAFKA_PLAINTEXT is forbidden for cluster integration Vitest (use MetalLB TLS + ≥3 seeds only).",
    );
  }

  const brokersVar =
    process.env.OCH_INTEGRATION_KAFKA_BROKERS?.trim() ||
    process.env.BOOKING_IT_KAFKA_BROKERS?.trim();
  if (brokersVar && !process.env.KAFKA_BROKER?.trim()) {
    process.env.KAFKA_BROKER = brokersVar;
  }

  const explicit = process.env.KAFKA_BROKER?.trim();
  if (explicit) {
    validateExplicitBrokerList(repoRoot, explicit);
    return;
  }

  if (!integrationKafkaFromK8sLbFlag()) {
    throw new Error(
      "[och-it] Kafka integration requires OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 (see service package.json test:integration) or preset KAFKA_BROKER with ≥3 TLS seeds + PEM paths.",
    );
  }

  applyKafkaBootstrapFromK8sExternalLbs(repoRoot);
}

/**
 * Fail-fast gate for root `test:integration:all` before listings/booking (requires built `services/common/dist`).
 * Mutates `process.env` like {@link applyVitestClusterKafkaBrokerEnv}.
 */
export function assertVitestKafkaClusterIntegrationPolicy(repoRoot: string): void {
  applyVitestClusterKafkaBrokerEnv(repoRoot);
}

/**
 * Kafka error codes (Apache Kafka protocol) we may retry during topic bootstrap / metadata.
 * @see https://kafka.apache.org/protocol#protocol_error_codes
 */
const TOPIC_BOOTSTRAP_RETRY_CODES = new Set([
  3, // UNKNOWN_TOPIC_OR_PARTITION
  5, // LEADER_NOT_AVAILABLE
  7, // REQUEST_TIMED_OUT
  19, // NOT_ENOUGH_REPLICAS
  20, // NOT_ENOUGH_REPLICAS_AFTER_APPEND
]);

/** Fail fast — do not mask misconfig or ACL issues with retries. */
const TOPIC_BOOTSTRAP_NO_RETRY_CODES = new Set([
  29, // TOPIC_AUTHORIZATION_FAILED
  31, // CLUSTER_AUTHORIZATION_FAILED
  38, // INVALID_REPLICATION_FACTOR
  17, // INVALID_TOPIC_EXCEPTION
  44, // POLICY_VIOLATION
  36, // TOPIC_ALREADY_EXISTS (surface; do not retry loop)
]);

function kafkaErrorCode(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const c = (e as { code?: number }).code;
  return typeof c === "number" ? c : undefined;
}

function isTopicBootstrapRetriable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    /INVALID_REPLICATION_FACTOR|TOPIC_AUTHORIZATION_FAILED|CLUSTER_AUTHORIZATION_FAILED|PolicyViolation|InvalidReplicationFactor|INVALID_TOPIC/i.test(
      msg,
    )
  ) {
    return false;
  }
  const code = kafkaErrorCode(e);
  if (code !== undefined && TOPIC_BOOTSTRAP_NO_RETRY_CODES.has(code)) {
    return false;
  }
  if (code !== undefined && TOPIC_BOOTSTRAP_RETRY_CODES.has(code)) {
    return true;
  }
  return /does not host this topic-partition|LeaderNotAvailable|not the leader|There is no leader/i.test(msg);
}

/**
 * Ensure a single topic exists (production-like clusters with auto-create disabled).
 */
export async function ensureVitestClusterKafkaTopic(topicName: string): Promise<void> {
  const raw = process.env.KAFKA_BROKER?.trim();
  if (!raw) {
    throw new Error("[och-it] topic bootstrap: KAFKA_BROKER is not set.");
  }

  enforceClusterKafkaBrokerSeedPolicy(raw);

  if (process.env.KAFKA_SSL_ENABLED !== "true") {
    throw new Error("[och-it] topic bootstrap requires KAFKA_SSL_ENABLED=true (plaintext forbidden).");
  }

  enforceTlsPemFilesExistOnDisk();

  const ssl = getKafkaSslConfigForTest(process.env);
  if (!ssl) {
    throw new Error("[och-it] topic bootstrap: TLS config missing (cert paths).");
  }

  const brokers = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const kafka = new Kafka({
    clientId: "och-vitest-cluster-topic-bootstrap",
    brokers,
    ssl,
    connectionTimeout: Number(process.env.KAFKAJS_CONNECTION_TIMEOUT_MS || "15000"),
    requestTimeout: 30000,
    retry: {
      retries: Number(process.env.KAFKAJS_METADATA_RETRIES || "8"),
      initialRetryTime: 200,
      maxRetryTime: 20000,
    },
  });

  const maxAttempts = Math.max(1, Number(process.env.OCH_KAFKA_TOPIC_BOOTSTRAP_RETRIES || "8"));
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const admin = kafka.admin();
    try {
      await admin.connect();
      const existing = await admin.listTopics();
      if (existing.includes(topicName)) {
        await assertTopicMinReplicationFactor(admin, topicName, MIN_TOPIC_REPLICATION_ENFORCED);
        console.log(`[och-it] Kafka topic already exists: ${topicName} (replication ≥${MIN_TOPIC_REPLICATION_ENFORCED} OK)`);
        return;
      }

      const created = await admin.createTopics({
        topics: [
          {
            topic: topicName,
            numPartitions: DEFAULT_TOPIC_PARTITIONS,
            replicationFactor: DEFAULT_TOPIC_REPLICATION,
          },
        ],
        waitForLeaders: true,
      });

      if (!created) {
        const again = await admin.listTopics();
        if (!again.includes(topicName)) {
          throw new Error(`[och-it] createTopics returned false and topic "${topicName}" is still missing.`);
        }
      }
      await assertTopicMinReplicationFactor(admin, topicName, MIN_TOPIC_REPLICATION_ENFORCED);
      console.log(
        `[och-it] Kafka topic created: ${topicName} (partitions=${DEFAULT_TOPIC_PARTITIONS}, rf=${DEFAULT_TOPIC_REPLICATION})`,
      );
      return;
    } catch (e) {
      lastErr = e;
      if (!isTopicBootstrapRetriable(e)) {
        throw e;
      }
      if (attempt >= maxAttempts) {
        break;
      }
      const delayMs = Math.min(1500 * attempt, 10_000);
      console.warn(
        `[och-it] topic bootstrap attempt ${attempt}/${maxAttempts} failed (${e instanceof Error ? e.message : String(e)}), retrying in ${delayMs}ms`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`[och-it] topic bootstrap failed after ${maxAttempts} attempts: ${String(lastErr)}`);
}
