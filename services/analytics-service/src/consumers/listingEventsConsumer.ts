/**
 * Consume ${ENV_PREFIX}.listing.events — project ListingCreatedV1 into analytics.daily_metrics (idempotent).
 */
import { kafka, ochKafkaTopicIsolationSuffix } from "@common/utils";
import type { Consumer } from "kafkajs";
import type { Pool } from "pg";
import { applyListingCreatedForAnalytics } from "../listing-metrics-projection.js";

const PREFIX = process.env.ENV_PREFIX || "dev";
export const ANALYTICS_LISTING_EVENTS_TOPIC =
  process.env.LISTING_EVENTS_TOPIC || `${PREFIX}.listing.events${ochKafkaTopicIsolationSuffix()}`;
const GROUP_ID = process.env.ANALYTICS_LISTING_KAFKA_GROUP || "analytics-service-listing-events";

type Envelope = {
  metadata?: { event_id?: string; event_type?: string; occurred_at?: string };
  payload?: Record<string, unknown>;
};

function parseEnvelope(buf: Buffer): Envelope | null {
  try {
    return JSON.parse(buf.toString("utf8")) as Envelope;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD from ISO timestamp (UTC calendar day). */
function dayFromOccurredAt(iso: string): string {
  const s = String(iso || "").trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export async function startListingEventsConsumer(pool: Pool | null): Promise<Consumer | null> {
  if (!pool) {
    console.warn("[analytics-listing-kafka] no pool — consumer not started");
    return null;
  }
  if (process.env.ANALYTICS_LISTING_KAFKA_CONSUMER === "0") {
    console.log("[analytics-listing-kafka] ANALYTICS_LISTING_KAFKA_CONSUMER=0 — skipped");
    return null;
  }
  if (process.env.KAFKA_SSL_ENABLED === "true") {
    const ca = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
    if (!ca) {
      console.warn("[analytics-listing-kafka] KAFKA_SSL_ENABLED but no CA — consumer not started");
      return null;
    }
  }

  const consumer = kafka.consumer({ groupId: GROUP_ID });
  const connectBudgetMs = Number(process.env.ANALYTICS_KAFKA_CONNECT_MS || "8000");
  try {
    await Promise.race([
      consumer.connect(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`kafka connect timeout after ${connectBudgetMs}ms`)), connectBudgetMs)
      ),
    ]);
    await consumer.subscribe({ topics: [ANALYTICS_LISTING_EVENTS_TOPIC], fromBeginning: false });
    console.log("[analytics-listing-kafka] subscribed:", ANALYTICS_LISTING_EVENTS_TOPIC);

    const logConsume =
      process.env.ANALYTICS_KAFKA_CONSUME_LOG === "1" ||
      process.env.ANALYTICS_KAFKA_CONSUME_LOG === "true";

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const v = message.value;
        if (!v) return;
        const env = parseEnvelope(v);
        if (!env) return;
        const meta = env.metadata;
        const eventId = String(meta?.event_id || "").trim();
        const eventType = String(meta?.event_type || "").trim();
        if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) return;
        if (eventType !== "ListingCreatedV1") return;

        const payload = (env.payload || {}) as Record<string, unknown>;
        const listedDay = String(payload.listed_at_day || "").trim().slice(0, 10);
        const day = /^\d{4}-\d{2}-\d{2}$/.test(listedDay)
          ? listedDay
          : dayFromOccurredAt(String(meta?.occurred_at || ""));
        if (logConsume) {
          const off = message.offset;
          console.log(
            JSON.stringify({
              msg: "analytics_listing_event_consumed",
              groupId: GROUP_ID,
              topic,
              partition,
              offset: off,
              event_id: eventId,
              event_type: eventType,
              listed_at_day: day,
            }),
          );
        }
        try {
          await applyListingCreatedForAnalytics(pool, eventId, day);
          if (logConsume) {
            console.log(
              JSON.stringify({
                msg: "analytics_listing_projection_ok",
                event_id: eventId,
                listed_at_day: day,
              }),
            );
          }
        } catch (e) {
          console.error("[analytics-listing-kafka] projection failed", e);
        }
      },
    });
    return consumer;
  } catch (e) {
    console.error("[analytics-listing-kafka] failed to start:", e);
    try {
      await consumer.disconnect();
    } catch {}
    return null;
  }
}
