/**
 * Kafka producer for community forum events (HTTP create post / comment paths).
 */
import { randomUUID } from "node:crypto";
import { kafka, ochKafkaTopicIsolationSuffix } from "@common/utils";
import { buildKafkaMessageHeaders, withKafkaProduceSpan } from "@common/utils/otel";

const ENV_PREFIX = process.env.ENV_PREFIX || "dev";
export const COMMUNITY_EVENTS_TOPIC =
  process.env.COMMUNITY_EVENTS_TOPIC ||
  `${ENV_PREFIX}.community.events.v1${ochKafkaTopicIsolationSuffix()}`;
const SERVICE_NAME = "listings-service";

const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
  await Promise.race([
    producer.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("kafka connect timeout")), connectMs),
    ),
  ]);
  producerReady = true;
}

export async function publishCommunityEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const event_id = randomUUID();
  await ensureProducer();
  await withKafkaProduceSpan(
    `kafka produce ${COMMUNITY_EVENTS_TOPIC}`,
    {
      "messaging.system": "kafka",
      "messaging.destination.name": COMMUNITY_EVENTS_TOPIC,
      "community.event_type": eventType,
      "community.aggregate_id": aggregateId,
    },
    async () => {
      await producer.send({
        topic: COMMUNITY_EVENTS_TOPIC,
        messages: [
          {
            key: aggregateId,
            headers: buildKafkaMessageHeaders(),
            value: JSON.stringify({
              metadata: {
                event_id,
                event_type: eventType,
                aggregate_id: aggregateId,
                aggregate_type: "community",
                occurred_at: new Date().toISOString(),
                producer: SERVICE_NAME,
                version: "1",
              },
              payload,
            }),
          },
        ],
      });
    },
  );
}
