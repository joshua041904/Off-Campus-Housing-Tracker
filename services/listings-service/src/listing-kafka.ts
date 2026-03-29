/**
 * Kafka producer for listing domain events (shared by gRPC + HTTP create).
 * Topic: ${ENV_PREFIX}.listing.events (see scripts/create-kafka-event-topics.sh).
 */
import { randomUUID } from "node:crypto";
import { kafka } from "@common/utils";

const ENV_PREFIX = process.env.ENV_PREFIX || "dev";
export const LISTING_EVENTS_TOPIC = process.env.LISTING_EVENTS_TOPIC || `${ENV_PREFIX}.listing.events`;
const SERVICE_NAME = "listings-service";

const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  try {
    const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
    await Promise.race([
      producer.connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("kafka connect timeout")), connectMs)),
    ]);
    producerReady = true;
  } catch {
    /* non-fatal */
  }
}

export async function publishListingEvent(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  /** When set (e.g. sync ingest + Kafka must share id for analytics processed_events dedupe), must be UUID. */
  eventIdOverride?: string
): Promise<void> {
  const event_id =
    eventIdOverride && /^[0-9a-f-]{36}$/i.test(eventIdOverride.trim())
      ? eventIdOverride.trim()
      : randomUUID();
  try {
    await ensureProducer();
    if (!producerReady) return;
    await producer.send({
      topic: LISTING_EVENTS_TOPIC,
      messages: [
        {
          key: aggregateId,
          value: JSON.stringify({
            metadata: {
              event_id,
              event_type: eventType,
              aggregate_id: aggregateId,
              aggregate_type: "listing",
              occurred_at: new Date().toISOString(),
              producer: SERVICE_NAME,
              version: "1",
            },
            payload,
          }),
        },
      ],
    });
  } catch {
    /* non-fatal */
  }
}
