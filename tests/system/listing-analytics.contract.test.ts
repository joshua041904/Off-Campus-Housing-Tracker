/**
 * System contract: **listings domain event → analytics projection**.
 *
 * Analytics consumes `${ENV_PREFIX}.listing.events` (ListingCreatedV1) and writes `analytics.processed_events` + bumps `daily_metrics.new_listings`.
 *
 * This path is **Kafka → analytics DB** (Vitest produces directly to the topic; no HTTP through listings-service, no messaging **outbox**).
 * Topic creation: `tests/system/global-setup.ts` + `ensureVitestClusterKafkaTopic` (suffix from `vitest.system.config.mts`: `.sys-<pid>-<time>` via `OCH_KAFKA_TOPIC_SUFFIX` / `ochKafkaTopicIsolationSuffix()`).
 * Consumer group: `vitest.system.config.mts` sets `ANALYTICS_LISTING_KAFKA_GROUP` per run so tests do not share `analytics-service-listing-events` with deployed analytics (that caused empty assignments + missed messages).
 * For transactional outbox behavior, use **messaging-service** `test:integration` (Tier 2).
 *
 * Requires: Colima/k3s Kafka (MetalLB), `certs/kafka-ssl*`, Postgres analytics on 5447 with `analytics.processed_events` + `daily_metrics`.
 *
 *   OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 pnpm run test:system
 *
 * Skip: SKIP_SYSTEM_CONTRACTS=1
 */
import { randomUUID } from "node:crypto";
import { Kafka, type Consumer } from "kafkajs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getKafkaSslConfigForTest, ochKafkaTopicIsolationSuffix } from "@common/utils";
import { countKafkaBrokerSeeds } from "@common/utils/kafka-vitest-cluster";
import { startListingEventsConsumer } from "../../services/analytics-service/src/consumers/listingEventsConsumer.js";
import { waitForCondition, waitForKafkaConsumption } from "./helpers/waitForCondition.js";

const skip =
  process.env.SKIP_SYSTEM_CONTRACTS === "1" || process.env.SKIP_SYSTEM_CONTRACTS === "true";

describe.skipIf(skip)("system contract: listing event → analytics projection", () => {
  let pool: pg.Pool;
  let consumer: Consumer | null = null;
  const eventId = randomUUID();
  const listingId = randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  const prefix = process.env.ENV_PREFIX || "dev";
  const topic =
    process.env.LISTING_EVENTS_TOPIC?.trim() ||
    `${prefix}.listing.events${ochKafkaTopicIsolationSuffix()}`;

  beforeAll(async () => {
    const conn =
      process.env.POSTGRES_URL_ANALYTICS ||
      "postgresql://postgres:postgres@127.0.0.1:5447/analytics";
    pool = new pg.Pool({ connectionString: conn, max: 5, connectionTimeoutMillis: 10_000 });
    await pool.query("SELECT 1");

    consumer = await startListingEventsConsumer(pool);
    if (!consumer) {
      throw new Error(
        "[system-contract] analytics listing consumer did not start (Kafka TLS / ANALYTICS_LISTING_KAFKA_CONSUMER=0?)",
      );
    }

    const raw = process.env.KAFKA_BROKER?.trim();
    if (!raw) throw new Error("KAFKA_BROKER not set (run via vitest.system.config.mts + cluster env)");
    const brokers = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (countKafkaBrokerSeeds(raw) < 3) {
      throw new Error("system contract expects ≥3 broker seeds");
    }
    const ssl = getKafkaSslConfigForTest(process.env);
    if (!ssl) throw new Error("TLS required for system Kafka produce");

    const kafka = new Kafka({
      clientId: "och-system-contract-listing-producer",
      brokers,
      ssl,
      connectionTimeout: 15_000,
    });

    const expectedGroup = process.env.ANALYTICS_LISTING_KAFKA_GROUP?.trim();
    if (!expectedGroup) {
      throw new Error("ANALYTICS_LISTING_KAFKA_GROUP missing (set by vitest.system.config.mts)");
    }
    await waitForCondition({
      description: `Kafka consumer group visible (${expectedGroup})`,
      timeoutMs: 20_000,
      intervalMs: 400,
      check: async () => {
        const admin = kafka.admin();
        await admin.connect();
        try {
          const { groups } = await admin.listGroups();
          if (groups.some((g) => g.groupId === expectedGroup)) return true;
        } finally {
          await admin.disconnect();
        }
        return null;
      },
    });

    const producer = kafka.producer();
    await producer.connect();
    const envelope = {
      metadata: {
        event_id: eventId,
        event_type: "ListingCreatedV1",
        aggregate_id: listingId,
        aggregate_type: "listing",
        occurred_at: new Date().toISOString(),
        producer: "system-contract-test",
        version: "1",
      },
      payload: { listed_at_day: day, listing_id: listingId },
    };
    await producer.send({
      topic,
      messages: [{ key: listingId, value: JSON.stringify(envelope) }],
    });
    await producer.disconnect();
  }, 90_000);

  afterAll(async () => {
    try {
      if (consumer) await consumer.disconnect();
    } catch {
      /* ignore */
    }
    try {
      if (pool) {
        await pool.query(`DELETE FROM analytics.processed_events WHERE event_id = $1::uuid`, [eventId]);
        await pool.query(
          `UPDATE analytics.daily_metrics SET new_listings = GREATEST(0, new_listings - 1) WHERE date = $1::date`,
          [day],
        );
      }
    } catch {
      /* best-effort idempotency cleanup */
    }
    await pool?.end();
  });

  it("analytics records processed_events for event_id after consume", async () => {
    await waitForKafkaConsumption({
      service: "analytics-service (listing consumer)",
      timeoutMs: 25_000,
      intervalMs: 500,
      check: async () => {
        const r = await pool.query(`SELECT 1 AS ok FROM analytics.processed_events WHERE event_id = $1::uuid`, [
          eventId,
        ]);
        if (r.rowCount && r.rowCount > 0) return true;
        return null;
      },
    });
    expect(true).toBe(true);
  });

  it("daily_metrics row exists for listing day (new_listings ≥ 1)", async () => {
    const r = await pool.query(
      `SELECT new_listings FROM analytics.daily_metrics WHERE date = $1::date`,
      [day],
    );
    expect(r.rows[0]).toBeDefined();
    expect(Number(r.rows[0].new_listings)).toBeGreaterThanOrEqual(1);
  });
});
