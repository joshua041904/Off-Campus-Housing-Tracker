/**
 * Match scripts/lib/och-kafka-event-topics-from-proto.sh + ochKafkaTopicIsolationSuffix().
 */
export function topicSuffixFromEnv(raw: string | undefined): string {
  let s = (raw ?? "").trim();
  while (s.startsWith(".")) s = s.slice(1);
  return s ? `.${s}` : "";
}

/**
 * - messaging → messaging.events.v1 (no prefix/suffix)
 * - others → `${prefix}.${stem}.events${suf}`
 * - plus booking.events.v1 and messaging.dlq
 */
export function buildExpectedTopics(protoNames: string[], envPrefix: string, suf: string): string[] {
  const topics: string[] = [];

  for (const p of protoNames) {
    if (p === "messaging") {
      topics.push("messaging.events.v1");
    } else {
      topics.push(`${envPrefix}.${p}.events${suf}`);
    }
  }

  topics.push(`${envPrefix}.booking.events.v1${suf}`);
  topics.push(`${envPrefix}.messaging.dlq${suf}`);

  return [...new Set(topics)].sort((a, b) => a.localeCompare(b));
}
