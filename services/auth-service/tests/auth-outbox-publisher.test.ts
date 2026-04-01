import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runAuthOutboxPublisherTickWithDeps,
  type AuthOutboxRow,
} from "../src/lib/auth-outbox-publisher.js";

describe("auth outbox publisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes each claimed row and marks published", async () => {
    const row: AuthOutboxRow = {
      id: "00000000-0000-4000-8000-000000000001",
      topic: "dev.user.lifecycle.v1",
      aggregate_id: "00000000-0000-4000-8000-000000000002",
      payload: Buffer.from("fake-envelope"),
    };
    const sendToKafka = vi.fn().mockResolvedValue(undefined);
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const bumpRetry = vi.fn().mockResolvedValue(undefined);
    const claimBatch = vi.fn().mockResolvedValue([row]);

    await runAuthOutboxPublisherTickWithDeps({
      claimBatch,
      markPublished,
      bumpRetry,
      sendToKafka,
      setGauge: vi.fn(),
    });

    expect(sendToKafka).toHaveBeenCalledWith(
      row.topic,
      row.aggregate_id,
      expect.any(Buffer),
    );
    expect(markPublished).toHaveBeenCalledWith(row.id);
    expect(bumpRetry).not.toHaveBeenCalled();
  });

  it("on Kafka outage: bumps retry_count and does not mark published", async () => {
    const row: AuthOutboxRow = {
      id: "00000000-0000-4000-8000-000000000003",
      topic: "dev.user.lifecycle.v1",
      aggregate_id: "00000000-0000-4000-8000-000000000004",
      payload: Buffer.from("x"),
    };
    const sendToKafka = vi.fn().mockRejectedValue(new Error("broker down"));
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const bumpRetry = vi.fn().mockResolvedValue(undefined);

    await runAuthOutboxPublisherTickWithDeps({
      claimBatch: vi.fn().mockResolvedValue([row]),
      markPublished,
      bumpRetry,
      sendToKafka,
      setGauge: vi.fn(),
    });

    expect(bumpRetry).toHaveBeenCalledWith(row.id);
    expect(markPublished).not.toHaveBeenCalled();
  });

  it("after simulated recovery: second tick publishes and marks published", async () => {
    const row: AuthOutboxRow = {
      id: "00000000-0000-4000-8000-000000000005",
      topic: "dev.user.lifecycle.v1",
      aggregate_id: "00000000-0000-4000-8000-000000000006",
      payload: Buffer.from("env"),
    };
    const sendToKafka = vi
      .fn()
      .mockRejectedValueOnce(new Error("outage"))
      .mockResolvedValueOnce(undefined);
    const markPublished = vi.fn().mockResolvedValue(undefined);
    const bumpRetry = vi.fn().mockResolvedValue(undefined);
    const claimBatch = vi.fn().mockResolvedValue([row]);

    await runAuthOutboxPublisherTickWithDeps({
      claimBatch,
      markPublished,
      bumpRetry,
      sendToKafka,
      setGauge: vi.fn(),
    });
    await runAuthOutboxPublisherTickWithDeps({
      claimBatch,
      markPublished,
      bumpRetry,
      sendToKafka,
      setGauge: vi.fn(),
    });

    expect(bumpRetry).toHaveBeenCalledTimes(1);
    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(sendToKafka).toHaveBeenCalledTimes(2);
  });
});
