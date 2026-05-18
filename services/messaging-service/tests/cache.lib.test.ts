/**
 * Unit tests for `src/lib/cache.ts` (Redis mocked; no real I/O).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function redisMock(opts: {
  evalshaImpl?: () => Promise<unknown>;
  evalImpl?: () => Promise<unknown>;
  getImpl?: () => Promise<string | null>;
  setnxImpl?: () => Promise<number>;
  multiExecImpl?: () => Promise<unknown>;
  scriptLoadImpl?: () => Promise<string>;
}): Record<string, ReturnType<typeof vi.fn>> {
  const evalsha = vi.fn().mockImplementation(() => opts.evalshaImpl?.() ?? Promise.resolve(["miss-wait", ""]));
  const evalFn = vi.fn().mockImplementation(() => opts.evalImpl?.() ?? Promise.resolve(["miss-wait", ""]));
  const get = vi.fn().mockImplementation(() => opts.getImpl?.() ?? Promise.resolve(null));
  const setnx = vi.fn().mockImplementation(() => opts.setnxImpl?.() ?? Promise.resolve(0));
  const pexpire = vi.fn().mockResolvedValue(undefined);
  const psetex = vi.fn().mockReturnThis();
  const del = vi.fn().mockReturnThis();
  const exec = vi.fn().mockImplementation(() => opts.multiExecImpl?.() ?? Promise.resolve([]));
  const multi = vi.fn(() => ({ psetex, del, exec }));
  const script = vi.fn().mockImplementation(() => opts.scriptLoadImpl?.() ?? Promise.resolve("sha1abc"));
  return { evalsha, eval: evalFn, get, setnx, pexpire, psetex, del, exec, multi, script };
}

describe("messaging cache.ts", () => {
  it("normalizeQ strips marks, collapses space, lowercases", async () => {
    vi.resetModules();
    const { normalizeQ } = await import("../src/lib/cache.js");
    expect(normalizeQ("  Café  résumé  ")).toBe("cafe resume");
    expect(normalizeQ("")).toBe("");
  });

  it("ckey and make* keys join segments", async () => {
    vi.resetModules();
    const { ckey, makePostKey, makePostsListKey, makeCommentsKey, makeMessagesKey, makeThreadKey } =
      await import("../src/lib/cache.js");
    expect(ckey(["a", null, 1])).toBe("a::1");
    expect(makePostKey("p1")).toContain("post:p1");
    expect(makePostsListKey(2, 10, undefined)).toContain("list:2:10:");
    expect(makeCommentsKey("c")).toContain("comments:c");
    expect(makeMessagesKey("u", 0, 5, undefined)).toContain("messages:u:0:5:");
    expect(makeThreadKey("t")).toContain("thread:t");
  });

  it("cached returns compute() when redis is null", async () => {
    vi.resetModules();
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue({ x: 1 });
    expect(await cached(null, "k", 60_000, compute)).toEqual({ x: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("cached returns compute() when ttlMs <= 0", async () => {
    vi.resetModules();
    const r = redisMock({});
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue(42);
    expect(await cached(r as never, "k", 0, compute)).toBe(42);
    expect(r.evalsha).not.toHaveBeenCalled();
  });

  it("cached returns payload on singleflight hit", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["hit", JSON.stringify({ v: 9 })]),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn();
    const out = await cached(r as never, "key-a", 5000, compute);
    expect(out).toEqual({ v: 9 });
    expect(compute).not.toHaveBeenCalled();
  });

  it("cached falls back to redis get on evalsha error (non-NOSCRIPT)", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.reject(new Error("CLUSTERDOWN")),
      getImpl: () => Promise.resolve(JSON.stringify({ ok: true })),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue("should-not-run");
    const out = await cached(r as never, "k2", 5000, compute);
    expect(out).toEqual({ ok: true });
    expect(compute).not.toHaveBeenCalled();
    expect(r.eval).not.toHaveBeenCalled();
  });

  it("cached retries evalsha after NOSCRIPT then returns hit", async () => {
    vi.resetModules();
    let n = 0;
    const r = redisMock({
      evalshaImpl: () => {
        n += 1;
        if (n === 1) return Promise.reject(new Error("NOSCRIPT No matching script"));
        return Promise.resolve(["hit", JSON.stringify({ recovered: true })]);
      },
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn();
    const out = await cached(r as never, "k-noscript", 5000, compute);
    expect(out).toEqual({ recovered: true });
    expect(compute).not.toHaveBeenCalled();
    expect(r.script).toHaveBeenCalled();
    expect(r.evalsha).toHaveBeenCalledTimes(2);
    expect(r.eval).not.toHaveBeenCalled();
  });

  it("cached falls back to EVAL after two NOSCRIPT errors", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.reject(new Error("NOSCRIPT")),
      evalImpl: () => Promise.resolve(["hit", JSON.stringify({ viaEval: true })]),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn();
    const out = await cached(r as never, "k-eval-fallback", 5000, compute);
    expect(out).toEqual({ viaEval: true });
    expect(compute).not.toHaveBeenCalled();
    expect(r.eval).toHaveBeenCalledTimes(1);
  });

  it("cached lock key is namespaced messaging:sf:lock:<sha1>", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-wait", ""]),
      getImpl: () => Promise.resolve(null),
      setnxImpl: () => Promise.resolve(1),
    });
    const { cached } = await import("../src/lib/cache.js");
    await cached(r as never, "my-cache-key", 2000, vi.fn().mockResolvedValue({ a: 1 }));
    const lockArg = (r.evalsha as ReturnType<typeof vi.fn>).mock.calls[0]?.[3] as string;
    expect(lockArg).toMatch(/^messaging:sf:lock:[a-f0-9]{40}$/);
    expect(r.setnx).toHaveBeenCalledWith(lockArg, "1");
  });

  it("cached uses plain get when evalsha returns miss and get returns JSON", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-open", ""]),
      getImpl: () => Promise.resolve(JSON.stringify([1, 2])),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn();
    expect(await cached(r as never, "k4", 5000, compute)).toEqual([1, 2]);
    expect(compute).not.toHaveBeenCalled();
  });

  it("cached ignores get failure and runs compute", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-open", ""]),
      getImpl: () => Promise.reject(new Error("redis get down")),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue({ fresh: 1 });
    expect(await cached(r as never, "k5", 5000, compute)).toEqual({ fresh: 1 });
  });

  it("cached miss-locked path sets value with multi when payload fits", async () => {
    vi.resetModules();
    vi.stubEnv("CACHE_MAX_BYTES", "999999");
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-locked", ""]),
      getImpl: () => Promise.resolve(null),
      multiExecImpl: () => Promise.resolve([]),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue({ z: 1 });
    await cached(r as never, "k6", 2000, compute);
    expect(r.multi).toHaveBeenCalled();
    expect(compute).toHaveBeenCalled();
  });

  it("cached miss-wait acquires lock via setnx and stores", async () => {
    vi.resetModules();
    vi.stubEnv("CACHE_MAX_BYTES", "999999");
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-wait", ""]),
      getImpl: () =>
        Promise.resolve(null) as Promise<string | null>,
      setnxImpl: () => Promise.resolve(1),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue({ w: 2 });
    await cached(r as never, "k7", 2000, compute);
    expect(r.setnx).toHaveBeenCalled();
    expect(r.pexpire).toHaveBeenCalled();
    expect(compute).toHaveBeenCalled();
  });

  it("cached miss-wait waits and returns key populated by other holder", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("CACHE_SINGLEFLIGHT_SLEEP_MS", "5");
    vi.stubEnv("CACHE_MAX_BYTES", "999999");
    let getCalls = 0;
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-wait", ""]),
      getImpl: () => {
        getCalls += 1;
        if (getCalls === 1) return Promise.resolve(null);
        return Promise.resolve(JSON.stringify({ raced: true }));
      },
      setnxImpl: () => Promise.resolve(0),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue({ alone: 1 });
    const p = cached(r as never, "k8", 2000, compute);
    await vi.advanceTimersByTimeAsync(10);
    const out = await p;
    expect(out).toEqual({ raced: true });
    expect(compute).not.toHaveBeenCalled();
  });

  it("cached skips set when JSON exceeds MAX_BYTES", async () => {
    vi.resetModules();
    vi.stubEnv("CACHE_MAX_BYTES", "10");
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-open", ""]),
      getImpl: () => Promise.resolve(null),
    });
    const { cached } = await import("../src/lib/cache.js");
    const big = { s: "x".repeat(500) };
    const compute = vi.fn().mockResolvedValue(big);
    expect(await cached(r as never, "k9", 2000, compute)).toBe(big);
    expect(r.psetex).not.toHaveBeenCalled();
  });

  it("stringifySafe serializes bigint within safe range and as string when huge", async () => {
    vi.resetModules();
    const r = redisMock({
      evalshaImpl: () => Promise.resolve(["miss-open", ""]),
      getImpl: () => Promise.resolve(null),
    });
    const { cached } = await import("../src/lib/cache.js");
    const compute = vi.fn().mockResolvedValue({ b: 9007199254740991n });
    await cached(r as never, "kb", 5000, compute);
    expect(r.psetex).toHaveBeenCalled();
    const json = String((r.psetex as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]);
    expect(json).toContain("9007199254740991");
  });
});
