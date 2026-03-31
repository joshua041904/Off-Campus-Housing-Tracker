import type { Kafka } from "kafkajs";

function parseOffsetHigh(high: string | undefined): bigint {
  if (high === undefined || high === "") return 0n;
  try {
    return BigInt(high);
  } catch {
    return 0n;
  }
}

/** Sum of partition high watermarks (KafkaJS fetchTopicOffsets: high = next offset / end position). */
export async function sumTopicHighWatermarks(kafka: Kafka, topic: string): Promise<bigint> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const parts = await admin.fetchTopicOffsets(topic);
    let sum = 0n;
    for (const p of parts) {
      sum += parseOffsetHigh(p.high);
    }
    return sum;
  } catch {
    return 0n;
  } finally {
    await admin.disconnect();
  }
}

/**
 * After producing, wait until the topic's combined high watermark exceeds `minExclusive`
 * (snapshot taken before the produce). Deterministic broker-side barrier without sleeping blindly.
 */
export async function waitForKafkaTopicHighBeyond(
  kafka: Kafka,
  opts: { topic: string; minExclusive: bigint; timeoutMs: number; pollMs?: number },
): Promise<void> {
  const poll = opts.pollMs ?? 200;
  const deadline = Date.now() + opts.timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const hi = await sumTopicHighWatermarks(kafka, opts.topic);
      if (hi > opts.minExclusive) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(
    `waitForKafkaTopicHighBeyond: topic ${opts.topic} did not advance past ${opts.minExclusive} within ${opts.timeoutMs}ms` +
      (lastErr ? ` (last error: ${lastErr})` : ""),
  );
}

export type WaitKafkaLagOptions = {
  groupId: string;
  /** Total lag across all assigned partitions must be <= this value. */
  maxLagTotal: number;
  timeoutMs: number;
  pollMs?: number;
};

/**
 * Poll consumer group lag until total lag <= maxLagTotal or timeout. Uses fetchOffsets + fetchTopicOffsets.
 */
export async function waitForKafkaConsumerLagAtMost(kafka: Kafka, opts: WaitKafkaLagOptions): Promise<void> {
  const poll = opts.pollMs ?? 200;
  const deadline = Date.now() + opts.timeoutMs;
  const admin = kafka.admin();
  await admin.connect();
  try {
    async function totalLag(): Promise<number> {
      const groupOffsets = await admin.fetchOffsets({ groupId: opts.groupId });
      let lag = 0;
      for (const t of groupOffsets) {
        const topicOffsets = await admin.fetchTopicOffsets(t.topic);
        for (const p of t.partitions) {
          const highEntry = topicOffsets.find((o) => o.partition === p.partition);
          const high = highEntry ? Number.parseInt(highEntry.high, 10) : 0;
          const raw = p.offset;
          if (raw === undefined) continue;
          const committed = Number.parseInt(String(raw), 10);
          if (Number.isNaN(committed) || committed < 0) {
            lag += high;
          } else {
            lag += Math.max(0, high - committed);
          }
        }
      }
      return lag;
    }

    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const lag = await totalLag();
        if (lag <= opts.maxLagTotal) return;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, poll));
    }
    throw new Error(
      `waitForKafkaConsumerLagAtMost: group ${opts.groupId} lag still > ${opts.maxLagTotal} after ${opts.timeoutMs}ms` +
        (lastErr ? ` (last error: ${lastErr})` : ""),
    );
  } finally {
    await admin.disconnect();
  }
}
