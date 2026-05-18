import { randomUUID } from "node:crypto";
import { kafka, ochKafkaTopicIsolationSuffix } from "@common/utils";
import { buildKafkaMessageHeaders, withKafkaProduceSpan } from "@common/utils/otel";

const ENV_PREFIX = process.env.ENV_PREFIX || "dev";
export const TRUST_EVENTS_TOPIC =
  process.env.TRUST_EVENTS_TOPIC || `${ENV_PREFIX}.trust.events.v1${ochKafkaTopicIsolationSuffix()}`;

const SERVICE_NAME = "booking-service";
const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
  await Promise.race([
    producer.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("kafka trust producer connect timeout")), connectMs),
    ),
  ]);
  producerReady = true;
}

export async function publishTrustEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await ensureProducer();
  /** Flat envelope for trust consumers (`tenant.banned`, etc.). */
  const message = {
    event_type: eventType,
    version: "v1",
    payload,
    meta: {
      event_id: randomUUID(),
      aggregate_id: aggregateId,
      occurred_at: new Date().toISOString(),
      producer: SERVICE_NAME,
    },
  };
  await withKafkaProduceSpan(
    `kafka produce ${TRUST_EVENTS_TOPIC}`,
    {
      "messaging.system": "kafka",
      "messaging.destination.name": TRUST_EVENTS_TOPIC,
      "trust.event_type": eventType,
      "trust.aggregate_id": aggregateId,
    },
    async () => {
      await producer.send({
        topic: TRUST_EVENTS_TOPIC,
        messages: [{ key: aggregateId, headers: buildKafkaMessageHeaders(), value: JSON.stringify(message) }],
      });
    },
  );
}
