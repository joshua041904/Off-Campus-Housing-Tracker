#!/usr/bin/env node
/**
 * CLI: proto-derived expected topics + live Kafka metadata validation.
 *
 * Usage:
 *   pnpm --filter kafka-contract run build
 *   node dist/index.js validate [options]
 *
 * Env: REPO_ROOT, KAFKA_CONTRACT_PROTO_ROOT, PROTO_ROOT, ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_BROKER, KAFKA_SSL_*,
 *   KAFKA_SSL_SKIP_HOSTNAME_CHECK=1 — dev only; TLS verify CA but skip broker hostname/SAN check (e.g. MetalLB IP not on cert).
 */
import fs from "node:fs";
import path from "node:path";
import kafkajs from "kafkajs";
import type { ConfigEntries } from "kafkajs";

const { ConfigResourceTypes } = kafkajs;
import { createKafkaFromEnv } from "./kafkaClient.js";
import { resolveOchRepoRoot, resolveProtoEventsDir, scanProtoEvents } from "./protoScanner.js";
import { buildExpectedTopics, topicSuffixFromEnv } from "./topicBuilder.js";
import type { KafkaContractConfig, ValidationReport } from "./types.js";
import { validateContract } from "./validator.js";

function repoRootFromTool(): string {
  const env = process.env.REPO_ROOT || process.env.GITHUB_WORKSPACE;
  if (env && fs.existsSync(env)) return path.resolve(env);
  return resolveOchRepoRoot(import.meta.url);
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const pos: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) flags.add(a);
    else pos.push(a);
  }
  return {
    cmd: pos[0] ?? "help",
    json: flags.has("--json"),
    strictTopics: flags.has("--strict-topics"),
    skipBrokerConfig: flags.has("--skip-broker-config"),
    brokerConfig: flags.has("--broker-config"),
    rackAware: flags.has("--rack-aware"),
    rollingSafe: flags.has("--rolling-restart-safe"),
    certCheck: flags.has("--check-cert-expiry"),
  };
}

async function runValidate(args: ReturnType<typeof parseArgs>): Promise<ValidationReport & { certNote?: string }> {
  const root = repoRootFromTool();
  const protoRoot = resolveProtoEventsDir(root);
  const envPrefix = process.env.ENV_PREFIX ?? "dev";
  const suf = topicSuffixFromEnv(process.env.OCH_KAFKA_TOPIC_SUFFIX);

  const protoNames = scanProtoEvents(protoRoot);
  const expectedTopics = buildExpectedTopics(protoNames, envPrefix, suf);

  const minClusterBrokers = Number(process.env.KAFKA_CONTRACT_MIN_BROKERS ?? "0");

  const configBase: Omit<KafkaContractConfig, "minReplicationFactor" | "minInSyncReplicas"> = {
    envPrefix,
    topicSuffix: suf,
    expectedPartitions: Number(process.env.PARTITIONS ?? process.env.EXPECTED_PARTITIONS ?? "6"),
    strictTopicSet: args.strictTopics || process.env.KAFKA_CONTRACT_STRICT_TOPICS === "1",
    requireAutoCreateDisabled:
      !args.skipBrokerConfig &&
      (args.brokerConfig || process.env.KAFKA_CONTRACT_CHECK_AUTO_CREATE === "1"),
    protoRoot,
    requireRackAwareness: args.rackAware || process.env.KAFKA_CONTRACT_RACK_AWARE === "1",
    minLeaderEntropyRatio: Number(process.env.KAFKA_CONTRACT_MIN_ENTROPY_RATIO ?? "0.8"),
    rollingRestartSafe: args.rollingSafe || process.env.KAFKA_CONTRACT_ROLLING_SAFE === "1",
    minClusterBrokers,
  };

  let certNote: string | undefined;
  if (args.certCheck || process.env.KAFKA_CONTRACT_CERT_MIN_DAYS) {
    const minD = Number(process.env.KAFKA_CONTRACT_CERT_MIN_DAYS ?? "14");
    const { X509Certificate } = await import("node:crypto");
    const certPath =
      process.env.KAFKA_CONTRACT_BROKER_CERT_PEM ||
      path.join(root, "certs/kafka-ssl/kafka-broker.crt");
    if (fs.existsSync(certPath)) {
      const cert = new X509Certificate(fs.readFileSync(certPath, "utf8"));
      const exp = new Date(cert.validTo);
      const days = (exp.getTime() - Date.now()) / 86400000;
      certNote = `Broker cert ${certPath} expires in ${days.toFixed(1)} days`;
      if (days < minD) {
        return {
          ok: false,
          errors: [
            {
              type: "CERT_EXPIRING",
              message: `Broker cert expires in ${days.toFixed(1)}d (< ${minD}d): ${certPath}`,
            },
          ],
          metrics: {
            brokerCount: 0,
            clusterBrokerCount: 0,
            leaderEntropy: 0,
            leaderEntropyRatio: 1,
            underReplicatedPartitions: 0,
            expectedTopicCount: expectedTopics.length,
            chaosReadinessScore: 1,
          },
          certNote,
        };
      }
    }
  }

  let minRF = Number(process.env.MIN_REPLICATION ?? "1");
  let minISR = Number(process.env.KAFKA_CONTRACT_MIN_ISR ?? "0");
  const kafka = createKafkaFromEnv();
  const admin = kafka.admin();
  await admin.connect();
  let brokerEntries: { name: string; value: string }[] | null = null;
  let clusterBrokerCount = 0;
  try {
    const cluster = await admin.describeCluster();
    clusterBrokerCount = cluster.brokers.length;
    if (process.env.KAFKA_CONTRACT_AUTO_TOPOLOGY === "1") {
      if (clusterBrokerCount >= 3) {
        minRF = 3;
        minISR = Math.max(minISR, 2);
      } else if (clusterBrokerCount === 2) {
        minRF = 2;
        minISR = Math.max(minISR, 1);
      } else {
        minRF = 1;
        minISR = Math.max(minISR, 1);
      }
    }

    const config: KafkaContractConfig = {
      ...configBase,
      minReplicationFactor: minRF,
      minInSyncReplicas: minISR,
    };

    const metadata = config.strictTopicSet
      ? await admin.fetchTopicMetadata()
      : await admin.fetchTopicMetadata({ topics: expectedTopics });
    if (config.requireAutoCreateDisabled) {
      const brokerId = cluster.brokers[0]?.nodeId;
      try {
        if (brokerId !== undefined) {
          const res = await admin.describeConfigs({
            resources: [{ type: ConfigResourceTypes.BROKER, name: String(brokerId) }],
            includeSynonyms: false,
          });
          const r = res.resources[0];
          brokerEntries = r
            ? r.configEntries.map((e: ConfigEntries) => ({
                name: e.configName,
                value: e.configValue ?? "",
              }))
            : [];
        } else {
          brokerEntries = null;
        }
      } catch {
        brokerEntries = null;
      }
    }

    const report = validateContract(config, expectedTopics, metadata, brokerEntries, clusterBrokerCount);
    const withEcho: ValidationReport & { certNote?: string } = {
      ...report,
      clusterBrokerCount: report.metrics.clusterBrokerCount,
      chaosReadinessScore: report.metrics.chaosReadinessScore,
      certNote,
    };
    return withEcho;
  } finally {
    await admin.disconnect();
  }
}

function printReport(report: ValidationReport & { certNote?: string }, json: boolean) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (report.certNote) console.log(report.certNote);
  console.log("Kafka contract metrics:", report.metrics);
  if (report.ok) {
    console.log("Kafka contract validation passed.");
    return;
  }
  console.error("\nKafka contract violations:\n");
  for (const e of report.errors) {
    console.error(`  [${e.type}] ${e.message}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.cmd === "help" || argv.includes("-h")) {
    console.log(`Usage: node dist/index.js validate [--json] [--strict-topics] [--broker-config] [--skip-broker-config]
  [--rack-aware] [--rolling-restart-safe] [--check-cert-expiry]
Env: REPO_ROOT, KAFKA_CONTRACT_PROTO_ROOT (absolute proto/events override), PROTO_ROOT (relative to repo),
  ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_BROKER, KAFKA_SSL_ENABLED,
  KAFKA_CONTRACT_CHECK_AUTO_CREATE=1 (or --broker-config) to assert auto.create.topics.enable=false via Admin API
  KAFKA_CONTRACT_MIN_BROKERS=N — fail if describeCluster broker count < N (quorum gate)
  OCH_KAFKA_REQUIRE_QUORUM_3=1 — scripts/validate-kafka-stack-contract.sh sets min brokers to 3 when used there
  KAFKA_CONTRACT_AUTO_TOPOLOGY=1 — set MIN_REPLICATION / MIN_ISR floors from cluster size (3→RF3 ISR≥2, 2→RF2 ISR≥1)
  KAFKA_CONTRACT_MIN_ISR — explicit min in-sync replica count per partition (used with or without AUTO_TOPOLOGY)`);
    process.exit(0);
  }

  if (args.cmd !== "validate") {
    console.error(`Unknown command: ${args.cmd}`);
    process.exit(2);
  }

  try {
    const report = await runValidate(args);
    printReport(report, args.json);
    process.exit(report.ok ? 0 : 1);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

void main();
