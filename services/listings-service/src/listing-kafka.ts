/**
 * Kafka producer for listing domain events (shared by gRPC + HTTP create).
 * Topic: ${ENV_PREFIX}.listing.events (see scripts/create-kafka-event-topics.sh).
 */
import { randomUUID } from "node:crypto";
import { kafka, ochKafkaTopicIsolationSuffix } from "@common/utils";

const ENV_PREFIX = process.env.ENV_PREFIX || "dev";
export const LISTING_EVENTS_TOPIC =
  process.env.LISTING_EVENTS_TOPIC || `${ENV_PREFIX}.listing.events${ochKafkaTopicIsolationSuffix()}`;
const SERVICE_NAME = "listings-service";

const producer = kafka.producer();
let producerReady = false;

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
  await Promise.race([
    producer.connect(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("kafka connect timeout")), connectMs)),
  ]);
  producerReady = true;
}

/** When unset or truthy, HTTP/gRPC handlers await Kafka send (503 on failure). When "0"/"false", fire-and-forget (log errors). */
export function listingsKafkaAwaitPublish(): boolean {
  const v = process.env.LISTINGS_KAFKA_AWAIT_PUBLISH?.trim().toLowerCase();
  if (v === undefined || v === "") return true;
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Same as publishListingEvent but does not block the response when LISTINGS_KAFKA_AWAIT_PUBLISH=0|false.
 * Use with ANALYTICS_SYNC_MODE=1 for E2E immediacy, or rely on analytics Kafka consumer for metrics.
 */
export async function publishListingEventForCreateResponse(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  eventIdOverride?: string
): Promise<void> {
  if (listingsKafkaAwaitPublish()) {
    await publishListingEvent(eventType, aggregateId, payload, eventIdOverride);
    return;
  }
  void publishListingEvent(eventType, aggregateId, payload, eventIdOverride).catch((e) => {
    console.error("[listings-kafka] fire-and-forget publish failed", e);
  });
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
  await ensureProducer();
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
}
