import type { ITopicMetadata, PartitionMetadata } from "kafkajs";
import type { KafkaContractConfig, ValidationError, ValidationMetrics, ValidationReport } from "./types.js";

function shannonEntropy(probs: number[]): number {
  return -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
}

function chaosReadinessScore(clusterBrokerCount: number, leaderEntropyRatio: number, underReplicatedPartitions: number): number {
  if (clusterBrokerCount < 2) return 1;
  const urFactor =
    underReplicatedPartitions === 0 ? 1 : Math.max(0, 1 - underReplicatedPartitions / 20);
  return Math.min(1, 0.7 * leaderEntropyRatio + 0.3 * urFactor);
}

export function validateContract(
  config: KafkaContractConfig,
  expectedTopics: string[],
  topicMetadata: { topics: ITopicMetadata[] },
  brokerConfigEntries: { name: string; value: string }[] | null,
  clusterBrokerCount: number,
): ValidationReport {
  const errors: ValidationError[] = [];
  if (config.minClusterBrokers > 0 && clusterBrokerCount < config.minClusterBrokers) {
    errors.push({
      type: "QUORUM_TOO_SMALL",
      message: `Cluster has ${clusterBrokerCount} broker(s); minimum ${config.minClusterBrokers} required`,
    });
  }
  const topicMap = new Map<string, ITopicMetadata>();
  for (const t of topicMetadata.topics) {
    topicMap.set(t.name, t);
  }

  const brokerRack = new Map<number, string | null | undefined>();
  const hasRackInfo = [...brokerRack.values()].some((v) => v != null && String(v).length > 0);

  let underRep = 0;
  const leaderCounts = new Map<number, number>();
  const brokerIds = new Set<number>();

  for (const topicName of expectedTopics) {
    const t = topicMap.get(topicName);
    if (!t) {
      errors.push({ type: "TOPIC_MISSING", message: `Missing topic: ${topicName}` });
      continue;
    }
    if (t.partitions.length !== config.expectedPartitions) {
      errors.push({
        type: "PARTITION_MISMATCH",
        message: `${topicName}: expected ${config.expectedPartitions} partitions, got ${t.partitions.length}`,
      });
    }
    for (const p of t.partitions) {
      validatePartition(
        config,
        topicName,
        p,
        errors,
        brokerRack,
        config.requireRackAwareness && hasRackInfo,
      );
      if (p.isr.length < p.replicas.length) {
        underRep += 1;
        if (config.rollingRestartSafe) {
          errors.push({
            type: "ROLLING_RESTART_UNSAFE",
            message: `${topicName} partition ${p.partitionId}: ISR ${p.isr.length} < replicas ${p.replicas.length}`,
          });
        }
      }
      const L = p.leader;
      if (L !== undefined && L >= 0) {
        leaderCounts.set(L, (leaderCounts.get(L) ?? 0) + 1);
        brokerIds.add(L);
      }
      for (const r of p.replicas) brokerIds.add(r);
    }
  }

  if (config.strictTopicSet) {
    const allowed = new Set(expectedTopics);
    for (const t of topicMetadata.topics) {
      if (t.name.startsWith("__")) continue;
      if (!allowed.has(t.name)) {
        errors.push({ type: "UNEXPECTED_TOPIC", message: `Unexpected topic: ${t.name}` });
      }
    }
  }

  if (config.requireAutoCreateDisabled && brokerConfigEntries) {
    const ent = brokerConfigEntries.find((e) => e.name === "auto.create.topics.enable");
    if (!ent || ent.value !== "false") {
      errors.push({
        type: "BROKER_CONFIG_INVALID",
        message: `auto.create.topics.enable must be false (got ${ent?.value ?? "unset"})`,
      });
    }
  }

  const brokerCount = Math.max(brokerIds.size, 1);
  const loads = [...leaderCounts.values()].filter((n) => n > 0);
  let leaderEntropy = 0;
  let ratio = 1;
  if (loads.length >= 2) {
    const total = loads.reduce((a, b) => a + b, 0);
    const probs = loads.map((l) => l / total);
    leaderEntropy = shannonEntropy(probs);
    const maxH = Math.log2(loads.length);
    ratio = maxH > 0 ? leaderEntropy / maxH : 1;
    if (ratio < config.minLeaderEntropyRatio) {
      errors.push({
        type: "PARTITION_SKEW",
        message: `Leader distribution entropy ratio ${ratio.toFixed(3)} < ${config.minLeaderEntropyRatio}`,
      });
    }
  }

  const metrics: ValidationMetrics = {
    brokerCount,
    clusterBrokerCount,
    leaderEntropy,
    leaderEntropyRatio: ratio,
    underReplicatedPartitions: underRep,
    expectedTopicCount: expectedTopics.length,
    chaosReadinessScore: chaosReadinessScore(clusterBrokerCount, ratio, underRep),
  };

  return { ok: errors.length === 0, errors, metrics };
}

function validatePartition(
  config: KafkaContractConfig,
  topicName: string,
  p: PartitionMetadata,
  errors: ValidationError[],
  brokerRack: Map<number, string | null | undefined>,
  rackAware: boolean,
): void {
  if (p.leader === undefined || p.leader < 0) {
    errors.push({
      type: "NO_LEADER",
      message: `${topicName} partition ${p.partitionId}: no leader`,
    });
  }
  if (p.replicas.length < config.minReplicationFactor) {
    errors.push({
      type: "REPLICATION_TOO_LOW",
      message: `${topicName} partition ${p.partitionId}: replicas ${p.replicas.length} < ${config.minReplicationFactor}`,
    });
  }
  if (p.isr.length !== p.replicas.length && !config.rollingRestartSafe) {
    errors.push({
      type: "UNDER_REPLICATED",
      message: `${topicName} partition ${p.partitionId}: ISR ${p.isr.length} !== replicas ${p.replicas.length}`,
    });
  }

  if (config.minInSyncReplicas > 0 && p.isr.length < config.minInSyncReplicas) {
    errors.push({
      type: "MIN_ISR_VIOLATION",
      message: `${topicName} partition ${p.partitionId}: ISR ${p.isr.length} < required min in-sync ${config.minInSyncReplicas}`,
    });
  }

  if (rackAware && p.replicas.length > 1) {
    const racks = new Set(
      p.replicas.map((id: number) => {
        const r = brokerRack.get(id);
        return r ?? "__none__";
      }),
    );
    if (racks.size <= 1) {
      errors.push({
        type: "RACK_AWARENESS_VIOLATION",
        message: `${topicName} partition ${p.partitionId}: replicas not spread across racks`,
      });
    }
  }
}
