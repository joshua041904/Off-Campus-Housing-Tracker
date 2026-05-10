import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQueryImpl = vi.fn();

vi.mock("pg", () => ({
  default: {
    Pool: class MockPool {
      totalCount = 0;
      idleCount = 0;
      waitingCount = 0;
      constructor(_opts: unknown) {}
      query = (...args: unknown[]) =>
        poolQueryImpl(...args) as Promise<unknown>;
    },
  },
}));

async function loadDb() {
  return import("../src/db.js");
}

describe("analytics db module", () => {
  beforeEach(() => {
    vi.resetModules();
    poolQueryImpl.mockReset();
    poolQueryImpl.mockResolvedValue({ rows: [] });
  });

  it("pool.query runs through concurrency guard", async () => {
    const { pool } = await loadDb();
    await Promise.all([pool.query("SELECT 1"), pool.query("SELECT 2")]);
    expect(poolQueryImpl).toHaveBeenCalledTimes(2);
  });
});
