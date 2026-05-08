/**
 * Structural tests for `src/kafka-consumer.ts` with KafkaJS and DB mocked.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectFn = vi.hoisted(() => vi.fn());
const subscribeFn = vi.hoisted(() => vi.fn());
const runFn = vi.hoisted(() => vi.fn());
const disconnectFn = vi.hoisted(() => vi.fn());
const ochSuffixFn = vi.hoisted(() => vi.fn(() => ""));

vi.mock("@common/utils/kafka", () => ({
  kafka: {
    consumer: vi.fn(() => ({
      connect: connectFn,
      subscribe: subscribeFn,
      run: runFn,
      disconnect: disconnectFn,
    })),
  },
  ochKafkaTopicIsolationSuffix: (...args: unknown[]) => ochSuffixFn(...args),
}));

let capturedEachMessage:
  | ((args: {
      topic: string;
      message: { value: Buffer | null; headers?: Record<string, Buffer | undefined> };
    }) => Promise<void>)
  | null = null;

describe("notification kafka-consumer", () => {
  const origEnv: Record<string, string | undefined> = {};
  const poolQuery = vi.fn();

  function saveEnv(key: string) {
    origEnv[key] = process.env[key];
  }

  function restoreEnv() {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  beforeEach(() => {
    Object.keys(origEnv).forEach((k) => delete origEnv[k]);
    saveEnv("ENV_PREFIX");
    saveEnv("NOTIFICATION_KAFKA_TOPICS");
    saveEnv("OCH_KAFKA_TOPIC_SUFFIX");
    saveEnv("NOTIFICATION_KAFKA_CONSUMER");
    saveEnv("KAFKA_SSL_ENABLED");
    saveEnv("KAFKA_CA_CERT");
    saveEnv("KAFKA_SSL_CA_PATH");
    saveEnv("KAFKA_GROUP_ID");
    saveEnv("NOTIFICATION_KAFKA_CONNECT_MS");

    process.env.ENV_PREFIX = "dev";
    delete process.env.NOTIFICATION_KAFKA_TOPICS;
    delete process.env.OCH_KAFKA_TOPIC_SUFFIX;
    delete process.env.NOTIFICATION_KAFKA_CONSUMER;
    delete process.env.KAFKA_SSL_ENABLED;
    delete process.env.KAFKA_CA_CERT;
    delete process.env.KAFKA_SSL_CA_PATH;
    delete process.env.KAFKA_GROUP_ID;
    process.env.NOTIFICATION_KAFKA_CONNECT_MS = "8000";

    connectFn.mockReset().mockResolvedValue(undefined);
    subscribeFn.mockReset().mockResolvedValue(undefined);
    disconnectFn.mockReset().mockResolvedValue(undefined);
    runFn.mockReset().mockImplementation(async (opts: { eachMessage: typeof capturedEachMessage }) => {
      capturedEachMessage = opts.eachMessage;
    });
    ochSuffixFn.mockReset().mockImplementation(() => "");
    poolQuery.mockReset();
    capturedEachMessage = null;
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("notificationKafkaTopics uses defaults and applies suffix except messaging.events.v1", async () => {
    ochSuffixFn.mockReturnValue(".iso");
    const { notificationKafkaTopics } = await import("../src/kafka-consumer.js");
    const t = notificationKafkaTopics();
    expect(t.some((x) => x === "messaging.events.v1")).toBe(true);
    expect(t.some((x) => x.endsWith(".iso") && x.includes("booking"))).toBe(true);
  });

  it("notificationKafkaTopics parses NOTIFICATION_KAFKA_TOPICS CSV", async () => {
    process.env.NOTIFICATION_KAFKA_TOPICS = " a.b , ,c.d ";
    const { notificationKafkaTopics } = await import("../src/kafka-consumer.js");
    expect(notificationKafkaTopics()).toEqual(["a.b", "c.d"]);
  });

  it("startNotificationConsumer returns null when pool is null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const c = await startNotificationConsumer(null);
    expect(c).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("startNotificationConsumer returns null when NOTIFICATION_KAFKA_CONSUMER=0", async () => {
    process.env.NOTIFICATION_KAFKA_CONSUMER = "0";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    const c = await startNotificationConsumer(pool);
    expect(c).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("startNotificationConsumer returns null when SSL enabled without CA", async () => {
    process.env.KAFKA_SSL_ENABLED = "true";
    delete process.env.KAFKA_CA_CERT;
    delete process.env.KAFKA_SSL_CA_PATH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    const c = await startNotificationConsumer(pool);
    expect(c).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("startNotificationConsumer starts consumer and eachMessage skips null value", async () => {
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    const c = await startNotificationConsumer(pool);
    expect(c).not.toBeNull();
    expect(connectFn).toHaveBeenCalled();
    expect(subscribeFn).toHaveBeenCalled();
    expect(capturedEachMessage).toBeTypeOf("function");
    await capturedEachMessage!({ topic: "t", message: { value: null } });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("eachMessage returns early when extractMeta fails", async () => {
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    await startNotificationConsumer(pool);
    await capturedEachMessage!({
      topic: "t",
      message: { value: Buffer.from("not-json{{{") },
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("eachMessage returns when userId missing", async () => {
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    await startNotificationConsumer(pool);
    await capturedEachMessage!({
      topic: "t",
      message: { value: Buffer.from(JSON.stringify({ type: "x", entity_id: "nope" })) },
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("eachMessage inserts when event is new and userId is uuid", async () => {
    const uid = randomUUID();
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    await startNotificationConsumer(pool);
    poolQuery.mockResolvedValueOnce({ rowCount: 1 });
    poolQuery.mockResolvedValueOnce({ rowCount: 1 });
    await capturedEachMessage!({
      topic: "dev.booking.events.v1",
      message: {
        value: Buffer.from(JSON.stringify({ event_id: randomUUID(), type: "Booked", entity_id: uid })),
      },
    });
    expect(poolQuery).toHaveBeenCalled();
    const insertProcessed = poolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && String(c[0]).includes("processed_events"),
    );
    expect(insertProcessed).toBeTruthy();
  });

  it("eachMessage skips insert when ensureProcessed returns false", async () => {
    const uid = randomUUID();
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    await startNotificationConsumer(pool);
    poolQuery.mockResolvedValueOnce({ rowCount: 0 });
    await capturedEachMessage!({
      topic: "t",
      message: {
        value: Buffer.from(JSON.stringify({ event_id: randomUUID(), type: "x", entity_id: uid })),
      },
    });
    const notificationInserts = poolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("INSERT INTO notification.notifications"),
    );
    expect(notificationInserts.length).toBe(0);
  });

  it("eachMessage logs when notification insert fails", async () => {
    const uid = randomUUID();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    await startNotificationConsumer(pool);
    poolQuery.mockResolvedValueOnce({ rowCount: 1 });
    poolQuery.mockRejectedValueOnce(new Error("insert boom"));
    await capturedEachMessage!({
      topic: "t",
      message: {
        value: Buffer.from(JSON.stringify({ event_id: randomUUID(), type: "x", entity_id: uid })),
      },
    });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("startNotificationConsumer disconnects and returns null on connect failure", async () => {
    connectFn.mockRejectedValueOnce(new Error("kafka down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    const c = await startNotificationConsumer(pool);
    expect(c).toBeNull();
    expect(disconnectFn).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("startNotificationConsumer returns null on connect timeout", async () => {
    process.env.NOTIFICATION_KAFKA_CONNECT_MS = "20";
    connectFn.mockImplementation(() => new Promise(() => {}));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startNotificationConsumer } = await import("../src/kafka-consumer.js");
    const pool = { query: poolQuery } as import("pg").Pool;
    const c = await startNotificationConsumer(pool);
    expect(c).toBeNull();
    expect(disconnectFn).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
