/**
 * Shared Kafka consumer for ${ENV_PREFIX}.user.lifecycle.v1 (user.account.deleted.v1).
 * Each service supplies schema-qualified processed_events + handler.
 */
import type { Consumer } from "kafkajs";
import { kafka } from "./kafka.js";

/** Portable alias for services that wrap `startUserLifecycleConsumer` (avoid kafkajs in every package.json). */
export type UserLifecycleKafkaConsumer = Consumer;
import {
  tryDecodeUserAccountDeletedEnvelope,
  userLifecycleV1Topic,
} from "./user-lifecycle-kafka.js";

const PROCESSED_SCHEMAS = new Set([
  "listings",
  "booking",
  "media",
  "messaging",
  "trust",
  "notification",
]);

type PgPoolLike = {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount?: number | null }>;
};

export function makeLifecycleEventClaimer(
  pool: PgPoolLike,
  schema: "listings" | "booking" | "media" | "messaging" | "trust" | "notification",
): (eventId: string) => Promise<boolean> {
  if (!PROCESSED_SCHEMAS.has(schema)) {
    throw new Error(`invalid processed_events schema: ${schema}`);
  }
  return async (eventId: string): Promise<boolean> => {
    const r = await pool.query(
      `INSERT INTO ${schema}.processed_events (event_id) VALUES ($1::uuid) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId],
    );
    return (r.rowCount ?? 0) > 0;
  };
}

export type UserLifecycleConsumerOptions = {
  serviceLabel: string;
  groupId: string;
  claimEvent: (eventId: string) => Promise<boolean>;
  onUserAccountDeleted: (userId: string, eventId: string) => Promise<void>;
};

export async function startUserLifecycleConsumer(
  opts: UserLifecycleConsumerOptions,
): Promise<UserLifecycleKafkaConsumer | null> {
  if (process.env.USER_LIFECYCLE_CONSUMER === "0") {
    console.log(`[${opts.serviceLabel}] USER_LIFECYCLE_CONSUMER=0 — lifecycle consumer skipped`);
    return null;
  }
  if (process.env.KAFKA_SSL_ENABLED === "true") {
    const ca = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
    if (!ca) {
      console.warn(`[${opts.serviceLabel}] lifecycle consumer: KAFKA_SSL_ENABLED but no CA — skipped`);
      return null;
    }
  }

  const topic = userLifecycleV1Topic();
  const consumer = kafka.consumer({ groupId: opts.groupId });
  const connectBudgetMs = Number(process.env.USER_LIFECYCLE_KAFKA_CONNECT_MS || "8000");
  try {
    await Promise.race([
      consumer.connect(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`lifecycle kafka connect timeout after ${connectBudgetMs}ms`)), connectBudgetMs),
      ),
    ]);
    await consumer.subscribe({ topics: [topic], fromBeginning: false });
    console.log(`[${opts.serviceLabel}] user lifecycle consumer subscribed: ${topic} group=${opts.groupId}`);

    await consumer.run({
      eachMessage: async ({ message }) => {
        const v = message.value;
        if (!v) return;
        const decoded = tryDecodeUserAccountDeletedEnvelope(Buffer.from(v));
        if (!decoded) return;
        const claimed = await opts.claimEvent(decoded.eventId);
        if (!claimed) return;
        try {
          await opts.onUserAccountDeleted(decoded.userId, decoded.eventId);
        } catch (e) {
          console.error(`[${opts.serviceLabel}] user lifecycle handler failed`, e);
        }
      },
    });
    return consumer;
  } catch (e) {
    console.error(`[${opts.serviceLabel}] user lifecycle consumer failed to start`, e);
    try {
      await consumer.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}
