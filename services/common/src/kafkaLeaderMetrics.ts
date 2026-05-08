import client from "prom-client";
import type { Admin } from "kafkajs";
import { register } from "./metrics.js";

/** Max broker share of partition leadership in sampled topic (0..1). High ⇒ single-broker dominance. */
export const ochKafkaLeaderImbalanceMaxRatio = new client.Gauge({
  name: "och_kafka_leader_imbalance_max_ratio",
  help: "Among sampled topic partitions, max(fraction of partitions led by one broker)",
  registers: [register],
});

/** Partition leader counts per broker id from a metadata snapshot (startup barrier). */
export const ochKafkaBrokerPartitionLeaders = new client.Gauge({
  name: "och_kafka_broker_partition_leaders",
  help: "Count of partitions where broker is leader (single-topic snapshot)",
  labelNames: ["broker_id"] as const,
  registers: [register],
});

function safeRegister(m: client.Metric): void {
  try {
    register.registerMetric(m);
  } catch {
    /* duplicate in tests */
  }
}

safeRegister(ochKafkaLeaderImbalanceMaxRatio);
safeRegister(ochKafkaBrokerPartitionLeaders);

const INTERNAL_TOPICS = /^(__consumer_offsets|__transaction_state)/;

/**
 * After admin.connect(), samples one topic's partition leadership for observability.
 * Skipped when OCH_KAFKA_LEADER_METRICS=0 or describe/fetch fails (non-fatal).
 */
export async function recordKafkaPartitionLeaderMetrics(admin: Admin): Promise<void> {
  if (process.env.OCH_KAFKA_LEADER_METRICS === "0" || process.env.OCH_KAFKA_LEADER_METRICS === "false") {
    return;
  }
  try {
    const forced = process.env.OCH_KAFKA_METRICS_TOPIC?.trim();
    let topic: string | undefined = forced || undefined;
    if (!topic) {
      const topics = (await admin.listTopics()).filter((t) => !INTERNAL_TOPICS.test(t));
      topic = topics.find((t) => /event|listing|user|booking|och/i.test(t)) ?? topics[0];
    }
    if (!topic) return;

    const meta = await admin.fetchTopicMetadata({ topics: [topic] });
    const tp = meta.topics[0]?.partitions;
    if (!tp?.length) return;

    const byBroker = new Map<string, number>();
    for (const p of tp) {
      const id = String(p.leader ?? "");
      if (!id || id === "-1") continue;
      byBroker.set(id, (byBroker.get(id) ?? 0) + 1);
    }
    const total = [...byBroker.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) return;

    const maxLed = Math.max(...byBroker.values());
    ochKafkaLeaderImbalanceMaxRatio.set(maxLed / total);

    for (const [brokerId, n] of byBroker) {
      ochKafkaBrokerPartitionLeaders.labels(brokerId).set(n);
    }
  } catch {
    /* best-effort; do not block startup */
  }
}
