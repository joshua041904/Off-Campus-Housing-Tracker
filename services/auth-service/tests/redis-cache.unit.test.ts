/**
 * Unit tests for redis-cache.ts using injected fake Redis clients.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRedisClientForTests,
  __setRedisClientForTests,
  cacheUser,
  checkEmailExistsInCache,
  getCacheStats,
  getRedisClient,
  getUserFromCache,
  invalidateUserCache,
} from "../src/lib/redis-cache.js";

function fakeClient(partial: Record<string, unknown>) {
  return partial as import("redis").RedisClientType;
}

describe("redis-cache", () => {
  afterEach(() => {
    __resetRedisClientForTests();
    vi.restoreAllMocks();
  });

  it("getRedisClient returns null after init catch (createClient throws)", async () => {
    const redisMod = await import("redis");
    const spy = vi.spyOn(redisMod, "createClient").mockImplementationOnce(() => {
      throw new Error("redis ctor boom");
    });
    __resetRedisClientForTests();
    expect(getRedisClient()).toBeNull();
    spy.mockRestore();
  });

  it("getUserFromCache returns null when client not open", async () => {
    __setRedisClientForTests(
      fakeClient({ isOpen: false, eval: vi.fn() }),
    );
    await expect(getUserFromCache("a@b.co")).resolves.toBeNull();
  });

  it("getUserFromCache returns null on cache miss (eval null)", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        eval: vi.fn().mockResolvedValue(null),
      }),
    );
    await expect(getUserFromCache("miss@example.com")).resolves.toBeNull();
  });

  it("getUserFromCache returns user on cache hit", async () => {
    const created = new Date().toISOString();
    const payload = JSON.stringify({
      id: "u1",
      email: "hit@example.com",
      passwordHash: "h",
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: created,
    });
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        eval: vi.fn().mockResolvedValue(payload),
      }),
    );
    const u = await getUserFromCache("Hit@Example.com");
    expect(u?.id).toBe("u1");
    expect(u?.createdAt).toBeInstanceOf(Date);
  });

  it("getUserFromCache returns null on invalid JSON from cache", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        eval: vi.fn().mockResolvedValue("not-json"),
      }),
    );
    await expect(getUserFromCache("badjson@example.com")).resolves.toBeNull();
  });

  it("getUserFromCache returns null when eval throws", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        eval: vi.fn().mockRejectedValue(new Error("eval down")),
      }),
    );
    await expect(getUserFromCache("err@example.com")).resolves.toBeNull();
  });

  it("cacheUser no-ops when client not open", async () => {
    __setRedisClientForTests(fakeClient({ isOpen: false, eval: vi.fn() }));
    await expect(
      cacheUser({
        id: "1",
        email: "c@e.com",
        passwordHash: "x",
        mfaEnabled: false,
        emailVerified: true,
        phoneVerified: false,
        createdAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it("cacheUser swallows eval failure", async () => {
    const evalFn = vi.fn().mockRejectedValue(new Error("no write"));
    __setRedisClientForTests(fakeClient({ isOpen: true, eval: evalFn }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await cacheUser({
      id: "1",
      email: "w@e.com",
      passwordHash: "x",
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });
    expect(warn).toHaveBeenCalled();
  });

  it("invalidateUserCache no-ops when client not open", async () => {
    __setRedisClientForTests(fakeClient({ isOpen: false, eval: vi.fn() }));
    await expect(invalidateUserCache("x@y.z")).resolves.toBeUndefined();
  });

  it("invalidateUserCache swallows eval failure", async () => {
    const evalFn = vi.fn().mockRejectedValue(new Error("del fail"));
    __setRedisClientForTests(fakeClient({ isOpen: true, eval: evalFn }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await invalidateUserCache("inv@example.com");
    expect(warn).toHaveBeenCalled();
  });

  it("checkEmailExistsInCache returns false when client not open", async () => {
    __setRedisClientForTests(fakeClient({ isOpen: false, exists: vi.fn() }));
    await expect(checkEmailExistsInCache("a@b.co")).resolves.toBe(false);
  });

  it("checkEmailExistsInCache returns true when key exists", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        exists: vi.fn().mockResolvedValue(1),
      }),
    );
    await expect(checkEmailExistsInCache("Ex@ample.com")).resolves.toBe(true);
  });

  it("checkEmailExistsInCache returns false when exists throws", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        exists: vi.fn().mockRejectedValue(new Error("e")),
      }),
    );
    await expect(checkEmailExistsInCache("t@t.tt")).resolves.toBe(false);
  });

  it("getCacheStats returns disconnected when client missing or closed", async () => {
    __setRedisClientForTests(null);
    await expect(getCacheStats()).resolves.toEqual({
      connected: false,
      userCacheKeys: 0,
    });
    __setRedisClientForTests(fakeClient({ isOpen: false }));
    await expect(getCacheStats()).resolves.toEqual({
      connected: false,
      userCacheKeys: 0,
    });
  });

  it("getCacheStats returns counts when keys() succeeds", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        keys: vi.fn().mockResolvedValue(["user:email:a@b.co", "user:email:c@d.co"]),
      }),
    );
    await expect(getCacheStats()).resolves.toEqual({
      connected: true,
      userCacheKeys: 2,
    });
  });

  it("getCacheStats returns disconnected when keys() throws", async () => {
    __setRedisClientForTests(
      fakeClient({
        isOpen: true,
        keys: vi.fn().mockRejectedValue(new Error("keys blocked")),
      }),
    );
    await expect(getCacheStats()).resolves.toEqual({
      connected: false,
      userCacheKeys: 0,
    });
  });
});
