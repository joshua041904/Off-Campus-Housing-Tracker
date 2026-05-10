/**
 * Unit coverage for `src/db.ts` (mocked `pg` Pool — no real TCP).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolQueryImpl = vi.fn();

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      totalCount = 0;
      idleCount = 0;
      waitingCount = 0;
      constructor(_opts: unknown) {}
      query = (...args: unknown[]) => poolQueryImpl(...args) as Promise<unknown>;
    },
  },
}));

async function loadDb() {
  return import("../src/db.js");
}

describe("trust db module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    poolQueryImpl.mockReset();
    poolQueryImpl.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    delete process.env.TRUST_DB_WARMUP;
    delete process.env.TRUST_DB_WARMUP_RETRIES;
    delete process.env.TRUST_DB_WARMUP_DELAY_MS;
    delete process.env.TRUST_DB_POOL_MAX;
    delete process.env.MAX_DB_CONCURRENCY;
    delete process.env.DB_CONCURRENCY_METRICS_MS;
    delete process.env.TRUST_DB_POOL_METRICS_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warmupTrustDb skips work when TRUST_DB_WARMUP=0", async () => {
    process.env.TRUST_DB_WARMUP = "0";
    const { warmupTrustDb } = await loadDb();
    await warmupTrustDb();
    expect(poolQueryImpl).not.toHaveBeenCalled();
  });

  it("warmupTrustDb runs SELECT 1 when warmup enabled", async () => {
    const { warmupTrustDb } = await loadDb();
    await warmupTrustDb();
    expect(poolQueryImpl).toHaveBeenCalled();
    const firstSql = String(poolQueryImpl.mock.calls[0]?.[0] ?? "");
    expect(firstSql).toContain("SELECT 1");
  });

  it("pool.query is wrapped by concurrency guard", async () => {
    const { pool } = await loadDb();
    await Promise.all([pool.query("SELECT 1"), pool.query("SELECT 2")]);
    expect(poolQueryImpl).toHaveBeenCalledTimes(2);
  });

  it("warmupTrustDb exhausts retries when DB stays down", async () => {
    process.env.TRUST_DB_WARMUP_RETRIES = "2";
    process.env.TRUST_DB_WARMUP_DELAY_MS = "1";
    poolQueryImpl.mockRejectedValue(new Error("down"));
    const { warmupTrustDb } = await loadDb();
    await warmupTrustDb();
    expect(poolQueryImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
