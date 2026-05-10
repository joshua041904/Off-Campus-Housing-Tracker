/**
 * Structural tests for `src/consumers/listingEventsConsumer.ts` with Kafka + projection mocked.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectFn = vi.hoisted(() => vi.fn());
const subscribeFn = vi.hoisted(() => vi.fn());
const runFn = vi.hoisted(() => vi.fn());
const disconnectFn = vi.hoisted(() => vi.fn());
const applyListing = vi.hoisted(() => vi.fn());

let capturedEachMessage:
  | ((args: {
      topic: string;
      partition: number;
      message: { value: Buffer | null; offset: string; headers?: Record<string, Buffer | undefined> };
    }) => Promise<void>)
  | null = null;

vi.mock("../src/listing-metrics-projection.js", () => ({
  applyListingCreatedForAnalytics: (...args: unknown[]) => applyListing(...args),
}));

vi.mock("@common/utils", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@common/utils")>();
  return {
    ...mod,
    kafka: {
      consumer: vi.fn(() => ({
        connect: connectFn,
        subscribe: subscribeFn,
        run: runFn,
        disconnect: disconnectFn,
      })),
    },
    ochKafkaTopicIsolationSuffix: vi.fn(() => ""),
  };
});

describe("listingEventsConsumer", () => {
  const orig: Record<string, string | undefined> = {};

  function save(k: string) {
    orig[k] = process.env[k];
  }

  function restore() {
    for (const [k, v] of Object.entries(orig)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  beforeEach(() => {
    Object.keys(orig).forEach((k) => delete orig[k]);
    save("ENV_PREFIX");
    save("LISTING_EVENTS_TOPIC");
    save("ANALYTICS_LISTING_KAFKA_CONSUMER");
    save("KAFKA_SSL_ENABLED");
    save("KAFKA_CA_CERT");
    save("KAFKA_SSL_CA_PATH");
    save("ANALYTICS_KAFKA_CONNECT_MS");
    save("ANALYTICS_KAFKA_CONSUME_LOG");

    process.env.ENV_PREFIX = "dev";
    delete process.env.LISTING_EVENTS_TOPIC;
    delete process.env.ANALYTICS_LISTING_KAFKA_CONSUMER;
    delete process.env.KAFKA_SSL_ENABLED;
    delete process.env.KAFKA_CA_CERT;
    delete process.env.KAFKA_SSL_CA_PATH;
    process.env.ANALYTICS_KAFKA_CONNECT_MS = "8000";
    delete process.env.ANALYTICS_KAFKA_CONSUME_LOG;

    connectFn.mockReset().mockResolvedValue(undefined);
    subscribeFn.mockReset().mockResolvedValue(undefined);
    disconnectFn.mockReset().mockResolvedValue(undefined);
    runFn.mockReset().mockImplementation(async (opts: { eachMessage: typeof capturedEachMessage }) => {
      capturedEachMessage = opts.eachMessage;
    });
    applyListing.mockReset().mockResolvedValue(undefined);
    capturedEachMessage = null;
    vi.resetModules();
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it("exports ANALYTICS_LISTING_EVENTS_TOPIC with prefix and suffix", async () => {
    const { ANALYTICS_LISTING_EVENTS_TOPIC } = await import("../src/consumers/listingEventsConsumer.js");
    expect(ANALYTICS_LISTING_EVENTS_TOPIC).toContain("listing.events");
  });

  it("returns null when pool is null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    expect(await startListingEventsConsumer(null)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null when ANALYTICS_LISTING_KAFKA_CONSUMER=0", async () => {
    process.env.ANALYTICS_LISTING_KAFKA_CONSUMER = "0";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    expect(await startListingEventsConsumer(pool)).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("returns null when SSL enabled without CA", async () => {
    process.env.KAFKA_SSL_ENABLED = "true";
    delete process.env.KAFKA_CA_CERT;
    delete process.env.KAFKA_SSL_CA_PATH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    expect(await startListingEventsConsumer(pool)).toBeNull();
    warn.mockRestore();
  });

  it("returns null and disconnects on connect failure", async () => {
    connectFn.mockRejectedValueOnce(new Error("no broker"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    expect(await startListingEventsConsumer(pool)).toBeNull();
    expect(disconnectFn).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("returns null on connect timeout", async () => {
    process.env.ANALYTICS_KAFKA_CONNECT_MS = "25";
    connectFn.mockImplementation(() => new Promise(() => {}));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    expect(await startListingEventsConsumer(pool)).toBeNull();
    expect(disconnectFn).toHaveBeenCalled();
    err.mockRestore();
  });

  it("eachMessage skips null payload", async () => {
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 0,
      message: { value: null, offset: "0" },
    });
    expect(applyListing).not.toHaveBeenCalled();
  });

  it("eachMessage skips invalid JSON", async () => {
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 0,
      message: { value: Buffer.from("{{{"), offset: "1" },
    });
    expect(applyListing).not.toHaveBeenCalled();
  });

  it("eachMessage skips bad event_id", async () => {
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 0,
      message: {
        value: Buffer.from(
          JSON.stringify({
            metadata: { event_id: "not-a-uuid", event_type: "ListingCreatedV1" },
            payload: {},
          }),
        ),
        offset: "2",
      },
    });
    expect(applyListing).not.toHaveBeenCalled();
  });

  it("eachMessage skips non-ListingCreatedV1", async () => {
    const eid = randomUUID();
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 0,
      message: {
        value: Buffer.from(
          JSON.stringify({
            metadata: { event_id: eid, event_type: "Other" },
            payload: {},
          }),
        ),
        offset: "3",
      },
    });
    expect(applyListing).not.toHaveBeenCalled();
  });

  it("eachMessage uses listed_at_day when valid", async () => {
    const eid = randomUUID();
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 0,
      message: {
        value: Buffer.from(
          JSON.stringify({
            metadata: { event_id: eid, event_type: "ListingCreatedV1", occurred_at: "2020-01-01T00:00:00Z" },
            payload: { listed_at_day: "2026-02-01" },
          }),
        ),
        offset: "4",
      },
    });
    expect(applyListing).toHaveBeenCalledWith(pool, eid, "2026-02-01");
  });

  it("eachMessage derives day from occurred_at when listed_at_day invalid", async () => {
    const eid = randomUUID();
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 0,
      message: {
        value: Buffer.from(
          JSON.stringify({
            metadata: { event_id: eid, event_type: "ListingCreatedV1", occurred_at: "2026-04-20T15:00:00.000Z" },
            payload: { listed_at_day: "not-a-day" },
          }),
        ),
        offset: "5",
      },
    });
    expect(applyListing).toHaveBeenCalledWith(pool, eid, "2026-04-20");
  });

  it("eachMessage logs consume + ok when ANALYTICS_KAFKA_CONSUME_LOG=1", async () => {
    process.env.ANALYTICS_KAFKA_CONSUME_LOG = "1";
    const eid = randomUUID();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await capturedEachMessage!({
      topic: "dev.listing.events",
      partition: 2,
      message: {
        value: Buffer.from(
          JSON.stringify({
            metadata: { event_id: eid, event_type: "ListingCreatedV1", occurred_at: "2026-05-01T00:00:00Z" },
            payload: { listed_at_day: "2026-05-01" },
          }),
        ),
        offset: "99",
      },
    });
    expect(log).toHaveBeenCalled();
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((s) => s.includes("analytics_listing_event_consumed"))).toBe(true);
    expect(lines.some((s) => s.includes("analytics_listing_projection_ok"))).toBe(true);
    log.mockRestore();
  });

  it("eachMessage logs projection failure without throwing", async () => {
    const eid = randomUUID();
    applyListing.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startListingEventsConsumer } = await import("../src/consumers/listingEventsConsumer.js");
    const pool = { query: vi.fn() } as import("pg").Pool;
    await startListingEventsConsumer(pool);
    await expect(
      capturedEachMessage!({
        topic: "dev.listing.events",
        partition: 0,
        message: {
          value: Buffer.from(
            JSON.stringify({
              metadata: { event_id: eid, event_type: "ListingCreatedV1", occurred_at: "2026-06-01T00:00:00Z" },
              payload: { listed_at_day: "2026-06-01" },
            }),
          ),
          offset: "6",
        },
      }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
