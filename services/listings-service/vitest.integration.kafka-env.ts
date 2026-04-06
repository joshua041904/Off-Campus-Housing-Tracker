import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root from services/listings-service/ */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function resolveKafkaTlsMaterialDir(): string | null {
  const ci = join(repoRoot, "certs", "kafka-ssl-ci");
  const dev = join(repoRoot, "certs", "kafka-ssl");
  if (existsSync(join(ci, "ca-cert.pem"))) return ci;
  if (existsSync(join(dev, "ca-cert.pem"))) return dev;
  return null;
}

/** Apply process.env for KafkaJS mTLS when PEM material exists (CI or local kafka-ssl-from-dev-root). */
export function applyIntegrationKafkaTlsEnv(): void {
  if (process.env.KAFKA_SSL_ENABLED === "false" || process.env.CI_KAFKA_PLAINTEXT === "1") {
    return;
  }
  const d = resolveKafkaTlsMaterialDir();
  if (!d) return;
  process.env.KAFKA_SSL_ENABLED ??= "true";
  process.env.KAFKA_BROKER ??= "127.0.0.1:29094";
  process.env.KAFKA_CA_CERT ??= join(d, "ca-cert.pem");
  process.env.KAFKA_CLIENT_CERT ??= join(d, "client.crt");
  process.env.KAFKA_CLIENT_KEY ??= join(d, "client.key");
}
