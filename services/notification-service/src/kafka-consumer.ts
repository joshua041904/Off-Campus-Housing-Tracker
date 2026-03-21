/**
 * Consume domain event topics; insert pending in-app notifications (idempotent via processed_events).
 */
import { kafka } from "@common/utils/kafka";
import { Consumer } from "kafkajs";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";

const PREFIX = process.env.ENV_PREFIX || "dev";

const DEFAULT_TOPIC_CSV = [
  `${PREFIX}.booking.events`,
  `${PREFIX}.listing.events`,
  `${PREFIX}.notification.events`,
  "messaging.events.v1",
].join(",");

function topics(): string[] {
  return (process.env.NOTIFICATION_KAFKA_TOPICS || DEFAULT_TOPIC_CSV)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureProcessed(pool: Pool, eventId: string): Promise<boolean> {
  try {
    const ins = await pool.query(
      `INSERT INTO notification.processed_events (event_id) VALUES ($1::uuid) ON CONFLICT (event_id) DO NOTHING`,
      [eventId]
    );
    return (ins.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

function extractMeta(buf: Buffer): { eventId: string; userId: string | null; eventType: string } | null {
  try {
    const j = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
    const eventId = String(j.event_id || j.id || randomUUID());
    const eventType = String(j.type || j.event_type || "domain.event");
    const entityId = String(j.entity_id || j.user_id || j.aggregate_id || "");
    const payload = (j.payload as Record<string, unknown>) || {};
    const userId =
      (entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null) ||
      (String(payload.user_id || payload.recipient_id || "") || null);
    return { eventId, userId: userId && userId.length >= 32 ? userId : null, eventType };
  } catch {
    return null;
  }
}

export async function startNotificationConsumer(pool: Pool | null): Promise<Consumer | null> {
  if (!pool) {
    console.warn("[notification-kafka] no pool — consumer not started");
    return null;
  }
  if (process.env.NOTIFICATION_KAFKA_CONSUMER === "0") {
    console.log("[notification-kafka] NOTIFICATION_KAFKA_CONSUMER=0 — skipped");
    return null;
  }
  if (process.env.KAFKA_SSL_ENABLED === "true") {
    const ca = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
    if (!ca) {
      console.warn("[notification-kafka] KAFKA_SSL_ENABLED but no CA — consumer not started");
      return null;
    }
  }

  const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID || "notification-service-group" });
  try {
    await consumer.connect();
    const t = topics();
    await consumer.subscribe({ topics: t, fromBeginning: false });
    console.log("[notification-kafka] subscribed:", t.join(", "));

    await consumer.run({
      eachMessage: async ({ message }) => {
        const v = message.value;
        if (!v) return;
        const meta = extractMeta(v);
        if (!meta?.userId) return;
        const ok = await ensureProcessed(pool, meta.eventId);
        if (!ok) return;
        try {
          await pool.query(
            `INSERT INTO notification.notifications (user_id, event_type, channel, status, payload)
             VALUES ($1::uuid, $2, 'push'::notification.notification_channel, 'pending', $3::jsonb)`,
            [meta.userId, meta.eventType, JSON.stringify({ source: "kafka", raw_preview: v.toString("utf8").slice(0, 2000) })]
          );
        } catch (e) {
          console.error("[notification-kafka] insert failed", e);
        }
      },
    });
    return consumer;
  } catch (e) {
    console.error("[notification-kafka] failed to start", e);
    try {
      await consumer.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}
