import { Kafka } from "kafkajs";
import * as fs from "fs";

// Strict TLS: no plaintext. When KAFKA_SSL_ENABLED=true, require CA + client cert + key (mTLS).
// Env: KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (or legacy KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY).
// Missing cert paths → throw (startup fails). No plaintext fallback.

if (process.env.NODE_ENV !== "production") {
  console.log("[kafka] broker required in non-production (no noop / bypass modes)");
}

/** For tests: validate TLS env and return config or throw. Use env param to avoid process.env at load time. */
export function getKafkaSslConfigForTest(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  if (env.KAFKA_SSL_ENABLED !== "true") return undefined;
  const caPath = env.KAFKA_CA_CERT || env.KAFKA_SSL_CA_PATH;
  const certPath = env.KAFKA_CLIENT_CERT || env.KAFKA_SSL_CERT_PATH;
  const keyPath = env.KAFKA_CLIENT_KEY || env.KAFKA_SSL_KEY_PATH;
  if (!caPath || !certPath || !keyPath) {
    throw new Error(
      "KAFKA_SSL_ENABLED=true requires all cert paths. Set KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (or KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY). No plaintext fallback.",
    );
  }
  return {
    rejectUnauthorized: true,
    ca: [fs.readFileSync(caPath, "utf-8")],
    cert: fs.readFileSync(certPath, "utf-8"),
    key: fs.readFileSync(keyPath, "utf-8"),
  };
}

/**
 * Optional isolation suffix for tests/CI (e.g. GITHUB_RUN_ID). Appended to default topic names when env vars
 * like LISTING_EVENTS_TOPIC are unset. Producers and consumers must share the same OCH_KAFKA_TOPIC_SUFFIX.
 */
export function ochKafkaTopicIsolationSuffix(): string {
  const raw = process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim();
  if (!raw) return "";
  const cleaned = raw.replace(/^\.+/, "");
  return cleaned ? `.${cleaned}` : "";
}

const sslConfig =
  process.env.KAFKA_SSL_ENABLED === "true"
    ? (() => {
        try {
          const caPath = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
          const certPath = process.env.KAFKA_CLIENT_CERT || process.env.KAFKA_SSL_CERT_PATH;
          const keyPath = process.env.KAFKA_CLIENT_KEY || process.env.KAFKA_SSL_KEY_PATH;

          if (!caPath || !certPath || !keyPath) {
            const msg =
              "[kafka] KAFKA_SSL_ENABLED=true requires all cert paths. Set KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (or KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY). No plaintext fallback.";
            console.error(msg);
            throw new Error(msg);
          }

          const config: Record<string, unknown> = {
            rejectUnauthorized: true,
            ca: [fs.readFileSync(caPath, "utf-8")],
            cert: fs.readFileSync(certPath, "utf-8"),
            key: fs.readFileSync(keyPath, "utf-8"),
          };
          return config;
        } catch (error) {
          console.error("[kafka] Error loading SSL certificates:", error);
          throw error;
        }
      })()
    : undefined;

const brokerPort = sslConfig ? "9093" : "9092";
const rawBrokerList = process.env.KAFKA_BROKER?.trim();
const kafkaBrokers: string[] = rawBrokerList
  ? rawBrokerList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [`kafka:${brokerPort}`];

export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "off-campus-housing-tracker",
  brokers: kafkaBrokers,
  ssl: sslConfig,
  connectionTimeout: Number(process.env.KAFKAJS_CONNECTION_TIMEOUT_MS || "4000"),
  requestTimeout: 25000,
  retry: {
    retries: Number(process.env.KAFKAJS_METADATA_RETRIES || "4"),
    initialRetryTime: 100,
    maxRetryTime: 15000,
  },
});

export type EnsureKafkaBrokerReadyOptions = {
  /** If set, startup fails unless every topic name exists (explicit infra; no auto-create). */
  requiredTopics?: string[];
};

/**
 * Fail-fast barrier: connect admin, list topics, disconnect. Call before binding HTTP/gRPC listeners.
 * Throws if the broker is unreachable or metadata cannot be loaded.
 *
 * Optional requiredTopics (or OCH_KAFKA_STARTUP_REQUIRED_TOPICS=comma-separated) enforce that topics
 * were created before services boot (see scripts/create-kafka-event-topics.sh).
 */
export async function ensureKafkaBrokerReady(
  serviceLabel: string,
  options?: EnsureKafkaBrokerReadyOptions,
): Promise<void> {
  const admin = kafka.admin();
  const budgetMs = Number(process.env.OCH_KAFKA_STARTUP_BARRIER_MS || "60000");
  const fromEnv =
    process.env.OCH_KAFKA_STARTUP_REQUIRED_TOPICS?.split(",")
      .map((t) => t.trim())
      .filter(Boolean) ?? [];
  const requiredTopics = [...new Set([...(options?.requiredTopics ?? []), ...fromEnv])];
  try {
    await Promise.race([
      (async () => {
        await admin.connect();
        const topics = await admin.listTopics();
        if (requiredTopics.length > 0) {
          const missing = requiredTopics.filter((t) => !topics.includes(t));
          if (missing.length > 0) {
            throw new Error(
              `Required Kafka topics missing: ${missing.join(", ")}. Create them before starting services (scripts/create-kafka-event-topics.sh).`,
            );
          }
        }
        await admin.disconnect();
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`Kafka startup barrier timeout after ${budgetMs}ms`)), budgetMs),
      ),
    ]);
    console.log(`[kafka] broker ready (${serviceLabel})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[kafka] FATAL: broker not reachable for ${serviceLabel}:`, msg);
    throw new Error(`[${serviceLabel}] Kafka broker required but unavailable: ${msg}`);
  }
}

/**
 * Check that Kafka broker is reachable. Use in health checks for services that depend on Kafka.
 * Creates an admin client, connects, then disconnects. Returns true if reachable, false otherwise.
 */
export async function checkKafkaConnectivity(): Promise<boolean> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.disconnect();
    return true;
  } catch {
    return false;
  }
}
