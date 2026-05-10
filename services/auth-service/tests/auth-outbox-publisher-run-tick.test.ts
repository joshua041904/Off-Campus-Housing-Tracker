import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const connect = vi.fn().mockResolvedValue(undefined);
const send = vi.fn().mockResolvedValue(undefined);
const disconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@common/utils/otel", () => ({
  buildKafkaMessageHeaders: vi.fn(() => ({})),
}));

vi.mock("@common/utils", () => ({
  kafka: {
    producer: vi.fn(() => ({
      connect,
      send,
      disconnect,
    })),
  },
}));

vi.mock("../src/lib/auth-outbox-metrics.js", () => ({
  setAuthOutboxUnpublishedCount: vi.fn(),
}));

describe("runAuthOutboxPublisherTick (integration-shaped)", () => {
  beforeEach(() => {
    vi.resetModules();
    connect.mockClear();
    send.mockClear();
    disconnect.mockClear();
    delete process.env.AUTH_OUTBOX_PUBLISHER;
    delete process.env.AUTH_OUTBOX_BATCH;
    delete process.env.KAFKA_CONNECT_TIMEOUT_MS;
  });

  afterEach(() => {
    delete process.env.AUTH_OUTBOX_PUBLISHER;
  });

  it("returns immediately when AUTH_OUTBOX_PUBLISHER=0", async () => {
    process.env.AUTH_OUTBOX_PUBLISHER = "0";
    const { runAuthOutboxPublisherTick } = await import("../src/lib/auth-outbox-publisher.js");
    const prisma = { $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    await runAuthOutboxPublisherTick(prisma as never);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("no-op batch: claimed 0, refreshes gauge via $queryRaw", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runAuthOutboxPublisherTick } = await import("../src/lib/auth-outbox-publisher.js");
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: (tx: { $queryRaw: ReturnType<typeof vi.fn> }) => unknown) => {
        const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
        return fn(tx);
      }),
      $queryRaw: vi.fn().mockResolvedValue([{ c: 3n }]),
      $executeRaw: vi.fn(),
    };
    await runAuthOutboxPublisherTick(prisma as never);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[0]).includes('"claimed":0'))).toBe(true);
    log.mockRestore();
  });

  it("publishes rows then marks published; send failure bumps retry", async () => {
    const row1 = {
      id: "00000000-0000-4000-8000-000000000099",
      topic: "dev.user.lifecycle.v1",
      aggregate_id: "00000000-0000-4000-8000-000000000088",
      payload: Buffer.from("e"),
    };
    const row2 = {
      id: "00000000-0000-4000-8000-0000000000aa",
      topic: "dev.user.lifecycle.v1",
      aggregate_id: "00000000-0000-4000-8000-0000000000bb",
      payload: Buffer.from("f"),
    };
    const { runAuthOutboxPublisherTick } = await import("../src/lib/auth-outbox-publisher.js");
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: (tx: { $queryRaw: ReturnType<typeof vi.fn> }) => unknown) => {
        const tx = { $queryRaw: vi.fn().mockResolvedValue([row1, row2]) };
        return fn(tx);
      }),
      $queryRaw: vi.fn().mockResolvedValue([{ c: 0n }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("kafka down"));
    await runAuthOutboxPublisherTick(prisma as never);
    expect(send).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("disconnectAuthOutboxProducer is safe when producer never connected", async () => {
    const { disconnectAuthOutboxProducer } = await import("../src/lib/auth-outbox-publisher.js");
    await expect(disconnectAuthOutboxProducer()).resolves.toBeUndefined();
  });
});
