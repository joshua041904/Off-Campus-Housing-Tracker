export interface KafkaContractConfig {
  envPrefix: string;
  topicSuffix: string;
  expectedPartitions: number;
  minReplicationFactor: number;
  /** From describeCluster; if >0 and below minClusterBrokers, validation fails. */
  minClusterBrokers: number;
  /** If >0, each partition must have ISR length >= this (topic min.insync.replicas contract). */
  minInSyncReplicas: number;
  strictTopicSet: boolean;
  requireAutoCreateDisabled: boolean;
  checkCertificateExpirationDays?: number;
  protoRoot: string;
  /** If true, multi-replica partitions must span >1 rack when broker.rack is present. */
  requireRackAwareness: boolean;
  /** Min ratio of Shannon entropy / max entropy for leader distribution (single-broker always passes). */
  minLeaderEntropyRatio: number;
  /** If true, fail when any partition has ISR length < replicas length. */
  rollingRestartSafe: boolean;
}

export type ValidationErrorType =
  | "TOPIC_MISSING"
  | "PARTITION_MISMATCH"
  | "REPLICATION_TOO_LOW"
  | "NO_LEADER"
  | "UNDER_REPLICATED"
  | "UNEXPECTED_TOPIC"
  | "BROKER_CONFIG_INVALID"
  | "CERT_EXPIRING"
  | "RACK_AWARENESS_VIOLATION"
  | "PARTITION_SKEW"
  | "ROLLING_RESTART_UNSAFE"
  | "QUORUM_TOO_SMALL"
  | "MIN_ISR_VIOLATION";

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
}

export interface ValidationMetrics {
  /** Brokers referenced in partition replica sets (may differ from live cluster size). */
  brokerCount: number;
  /** Brokers returned by describeCluster (authoritative for quorum). */
  clusterBrokerCount: number;
  leaderEntropy: number;
  leaderEntropyRatio: number;
  underReplicatedPartitions: number;
  expectedTopicCount: number;
  /** Composite 0–1 score for optional infra gates (entropy + under-replication penalty). */
  chaosReadinessScore: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationError[];
  metrics: ValidationMetrics;
  /** Same as metrics.clusterBrokerCount (top-level for jq). */
  clusterBrokerCount?: number;
  /** Same as metrics.chaosReadinessScore (top-level for jq). */
  chaosReadinessScore?: number;
}
