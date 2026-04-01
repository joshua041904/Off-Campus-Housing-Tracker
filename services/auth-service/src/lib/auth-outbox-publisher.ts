/**
 * Picks unpublished auth_outbox rows (FOR UPDATE SKIP LOCKED), publishes to Kafka, sets published_at.
 * Safe under at-least-once: consumers dedupe by envelope event_id.
 */
import type { PrismaClient } from "../../prisma/generated/client";
import { kafka } from "@common/utils";
import { setAuthOutboxUnpublishedCount } from "./auth-outbox-metrics.js";

const producer = kafka.producer();
let producerReady = false;

export type AuthOutboxRow = {
  id: string;
  topic: string;
  aggregate_id: string;
  payload: Buffer;
};

async function ensureProducer(): Promise<void> {
  if (producerReady) return;
  if (process.env.AUTH_OUTBOX_PUBLISHER === "0") {
    throw new Error("AUTH_OUTBOX_PUBLISHER=0");
  }
  const connectMs = Number(process.env.KAFKA_CONNECT_TIMEOUT_MS || "2500");
  await Promise.race([
    producer.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("kafka connect timeout")), connectMs),
    ),
  ]);
  producerReady = true;
}

async function refreshUnpublishedCount(prisma: Pick<PrismaClient, "$queryRaw">): Promise<number> {
  const r = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM auth.auth_outbox WHERE published_at IS NULL
  `;
  const n = Number(r[0]?.c ?? 0);
  const v = Number.isFinite(n) ? n : 0;
  setAuthOutboxUnpublishedCount(v);
  return v;
}

/**
 * Claim up to `take` unpublished rows inside one transaction (row locks released on commit).
 * Then publishes outside that transaction and updates published_at per row.
 */
export async function runAuthOutboxPublisherTick(prisma: PrismaClient): Promise<void> {
  if (process.env.AUTH_OUTBOX_PUBLISHER === "0") {
    return;
  }
  const tickStarted = Date.now();
  const takeRaw = Number(process.env.AUTH_OUTBOX_BATCH || "50");
  const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(200, Math.floor(takeRaw)) : 50;

  const rows = await prisma.$transaction(async (tx) => {
    return tx.$queryRaw<AuthOutboxRow[]>`
      WITH picked AS (
        SELECT id FROM auth.auth_outbox
        WHERE published_at IS NULL
        ORDER BY created_at ASC
        LIMIT ${take}
        FOR UPDATE SKIP LOCKED
      )
      SELECT b.id::text AS id, b.topic, b.aggregate_id, b.payload
      FROM auth.auth_outbox b
      INNER JOIN picked p ON b.id = p.id
    `;
  });

  if (rows.length === 0) {
    const unpublishedRemaining = await refreshUnpublishedCount(prisma);
    const latencyMs = Date.now() - tickStarted;
    console.log(
      JSON.stringify({
        msg: "auth_outbox_publish_batch",
        claimed: 0,
        published: 0,
        failed: 0,
        latency_ms: latencyMs,
        unpublished_remaining: unpublishedRemaining,
        note: "no rows",
      }),
    );
    return;
  }

  await ensureProducer();

  let published = 0;
  let failed = 0;
  for (const row of rows) {
    const buf = Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload as Uint8Array);
    try {
      await producer.send({
        topic: row.topic,
        messages: [{ key: row.aggregate_id, value: buf }],
      });
      await prisma.$executeRaw`
        UPDATE auth.auth_outbox SET published_at = NOW() WHERE id = ${row.id}::uuid
      `;
      published += 1;
    } catch (e) {
      failed += 1;
      console.error("[auth-outbox] publish failed for", row.id, e);
      await prisma.$executeRaw`
        UPDATE auth.auth_outbox SET retry_count = retry_count + 1 WHERE id = ${row.id}::uuid
      `;
    }
  }

  const unpublishedRemaining = await refreshUnpublishedCount(prisma);
  const latencyMs = Date.now() - tickStarted;
  console.log(
    JSON.stringify({
      msg: "auth_outbox_publish_batch",
      claimed: rows.length,
      published,
      failed,
      latency_ms: latencyMs,
      unpublished_remaining: unpublishedRemaining,
    }),
  );
}

export function startAuthOutboxPublisher(prisma: PrismaClient): NodeJS.Timeout | null {
  if (process.env.AUTH_OUTBOX_PUBLISHER === "0") {
    console.log("[auth-outbox] AUTH_OUTBOX_PUBLISHER=0 — background publisher disabled");
    return null;
  }
  const ms = Number(process.env.AUTH_OUTBOX_PUBLISHER_INTERVAL_MS || "2000");
  const interval = Number.isFinite(ms) && ms >= 500 ? ms : 2000;

  void runAuthOutboxPublisherTick(prisma).catch((e) =>
    console.error("[auth-outbox] initial tick failed", e),
  );

  return setInterval(() => {
    void runAuthOutboxPublisherTick(prisma).catch((e) =>
      console.error("[auth-outbox] tick failed", e),
    );
  }, interval);
}

export async function disconnectAuthOutboxProducer(): Promise<void> {
  if (!producerReady) return;
  try {
    await producer.disconnect();
  } catch {
    /* ignore */
  }
  producerReady = false;
}

/** Test hook: run one tick with injected send + prisma ops. */
export type OutboxPublisherTestDeps = {
  claimBatch: () => Promise<AuthOutboxRow[]>;
  markPublished: (id: string) => Promise<void>;
  bumpRetry: (id: string) => Promise<void>;
  sendToKafka: (topic: string, key: string, payload: Buffer) => Promise<void>;
  setGauge: (n: number) => void;
};

export async function runAuthOutboxPublisherTickWithDeps(deps: OutboxPublisherTestDeps): Promise<void> {
  const rows = await deps.claimBatch();
  for (const row of rows) {
    const buf = Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload as Uint8Array);
    try {
      await deps.sendToKafka(row.topic, row.aggregate_id, buf);
      await deps.markPublished(row.id);
    } catch {
      await deps.bumpRetry(row.id);
    }
  }
  deps.setGauge(0);
}
