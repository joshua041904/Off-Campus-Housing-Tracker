import fs from "node:fs";
import kafkajs from "kafkajs";
import type { KafkaConfig } from "kafkajs";
import type { ConnectionOptions } from "node:tls";

const { Kafka, logLevel } = kafkajs;

export function loadSslFromEnv(): ConnectionOptions | undefined {
  if (process.env.KAFKA_SSL_ENABLED !== "true") return undefined;
  const caPath = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
  const certPath = process.env.KAFKA_CLIENT_CERT || process.env.KAFKA_SSL_CERT_PATH;
  const keyPath = process.env.KAFKA_CLIENT_KEY || process.env.KAFKA_SSL_KEY_PATH;
  if (!caPath || !certPath || !keyPath) {
    throw new Error(
      "KAFKA_SSL_ENABLED=true requires KAFKA_CA_CERT (or KAFKA_SSL_CA_PATH), KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY",
    );
  }
  const base: ConnectionOptions = {
    rejectUnauthorized: true,
    ca: [fs.readFileSync(caPath, "utf8")],
    cert: fs.readFileSync(certPath, "utf8"),
    key: fs.readFileSync(keyPath, "utf8"),
  };
  // Dev / Colima: broker cert SANs often list service DNS, not MetalLB pool IPs (e.g. 192.168.64.x).
  if (process.env.KAFKA_SSL_SKIP_HOSTNAME_CHECK === "1") {
    return {
      ...base,
      checkServerIdentity: () => undefined,
    };
  }
  return base;
}

export function createKafkaFromEnv(): InstanceType<typeof Kafka> {
  // Match docker-compose EXTERNAL advertised listener (localhost:29094) so metadata hostnames resolve on the Mac host.
  const brokers = (process.env.KAFKA_BROKER || "localhost:29094")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ssl = loadSslFromEnv();
  const cfg: KafkaConfig = {
    clientId: process.env.KAFKA_CONTRACT_CLIENT_ID || "kafka-contract",
    brokers,
    ssl,
    connectionTimeout: Number(process.env.KAFKAJS_CONNECTION_TIMEOUT_MS || "10000"),
    requestTimeout: 30000,
    logLevel: process.env.KAFKA_CONTRACT_DEBUG === "1" ? logLevel.INFO : logLevel.NOTHING,
  };
  return new Kafka(cfg);
}
