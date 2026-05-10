import * as grpc from "@grpc/grpc-js";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import { signJwt } from "@common/utils/auth";
import { hashPassword } from "../src/lib/bcrypt-queue";
import * as redisCache from "../src/lib/redis-cache.js";
import * as mfaLib from "../src/lib/mfa";
import { prisma } from "../src/lib/prisma";
import {
  __testClearRevocationMemory,
  __testSeedRevokedJti,
} from "../src/lib/revocation.js";
import * as revocation from "../src/lib/revocation.js";
import * as bcryptQueue from "../src/lib/bcrypt-queue.js";
import {
  grpcHandlersForTest,
  grpcWithLoggingForTest,
} from "../src/grpc-server";

function grpcSql(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): string {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += `«${String(values[i])}»`;
  }
  return out;
}

function runCallback<T>(
  invoke: (cb: (err: T | null, res?: unknown) => void) => void,
): Promise<{ err: T | null; res?: unknown }> {
  return new Promise((resolve, reject) => {
    try {
      invoke((err, res) => {
        resolve({ err, res });
      });
    } catch (e) {
      reject(e);
    }
  });
}

describe("grpc-server.ts handler harness", { timeout: 30_000 }, () => {
  afterEach(() => {
    __testClearRevocationMemory();
    vi.restoreAllMocks();
  });

  it("Register — missing email/password → INVALID_ARGUMENT", async () => {
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Register({ request: {} }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("Authenticate — missing password → INVALID_ARGUMENT", async () => {
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        { request: { email: "a@b.co" } },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("ValidateToken — empty token → INVALID_ARGUMENT", async () => {
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token: "" } }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("ValidateToken — invalid JWT → UNAUTHENTICATED INVALID_TOKEN", async () => {
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token: "bad" } }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("ValidateToken — expired JWT → UNAUTHENTICATED EXPIRED_TOKEN", async () => {
    const secret = process.env.JWT_SECRET || "dev";
    const expired = jwt.sign(
      { sub: randomUUID(), email: "e@e.com", jti: randomUUID() },
      secret,
      { expiresIn: "-120s" },
    );
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token: expired } }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("ValidateToken — missing sub after verify → UNAUTHENTICATED", async () => {
    const token = jwt.sign(
      { email: "x@y.z", jti: randomUUID() },
      process.env.JWT_SECRET || "dev",
      { expiresIn: "1h", algorithm: "HS256" },
    );
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("ValidateToken — prisma failure after verify → UNAUTHENTICATED", async () => {
    const token = signJwt({
      sub: randomUUID(),
      email: "grpc@example.com",
    });
    const rawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("db"));
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
    rawSpy.mockRestore();
  });

  it("RefreshToken — missing token → INVALID_ARGUMENT", async () => {
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.RefreshToken({ request: {} }, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("RefreshToken — invalid JWT → UNAUTHENTICATED", async () => {
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.RefreshToken(
        { request: { refresh_token: "nope" } },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("HealthCheck — returns healthy flag object", async () => {
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.HealthCheck({ request: {} }, cb),
    );
    expect(err).toBeNull();
    expect(res).toMatchObject({
      healthy: expect.any(Boolean),
      version: expect.any(String),
    });
  });

  it("healthV1Check — returns status payload", async () => {
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.healthV1Check({}, cb),
    );
    expect(err).toBeNull();
    expect(res).toMatchObject({
      status: expect.any(Number),
      message: expect.any(String),
      details: expect.any(Object),
    });
  });

  it("grpcWithLogging — handler throws → INTERNAL_ERROR", async () => {
    const wrapped = grpcWithLoggingForTest(
      async (_call: unknown, _cb: unknown) => {
        throw new Error("boom");
      },
      "Throwing",
    );
    const { err } = await runCallback((cb) =>
      wrapped(
        {
          metadata: { getMap: () => ({}) },
          getPeer: () => "test",
          host: "test",
        },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
  });

  it("Register — success (cache miss, insert, token)", async () => {
    const userId = randomUUID();
    const email = `grpc-reg-${userId.slice(0, 8)}@example.com`;
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
    vi.spyOn(prisma, "$queryRaw").mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const t = grpcSql(strings, values);
        if (t.includes("SELECT id FROM auth.users WHERE email")) {
          return Promise.resolve([]);
        }
        if (t.includes("INSERT INTO auth.users")) {
          return Promise.resolve([
            {
              id: userId,
              email,
              createdAt: new Date(),
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.Register(
        {
          request: { email, password: "grpcPassword!1" },
        },
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { token?: string })?.token).toBeTruthy();
    expect((res as { user?: { id: string } })?.user?.id).toBe(userId);
  });

  it("Authenticate — cache hit success (non-MFA)", async () => {
    const userId = randomUUID();
    const email = `grpc-auth-${userId.slice(0, 8)}@example.com`;
    const passwordHash = await hashPassword("SamePass!2");
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue({
      id: userId,
      email,
      passwordHash,
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });

    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        { request: { email, password: "SamePass!2" } },
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { token?: string; requires_mfa?: boolean })?.token).toBeTruthy();
    expect((res as { requires_mfa?: boolean })?.requires_mfa).toBe(false);
  });

  it("Authenticate — MFA required when enabled and no code", async () => {
    const userId = randomUUID();
    const email = `grpc-mfa-${userId.slice(0, 8)}@example.com`;
    const passwordHash = await hashPassword("MfaPass!3");
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue({
      id: userId,
      email,
      passwordHash,
      mfaEnabled: true,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });

    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        { request: { email, password: "MfaPass!3" } },
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { requires_mfa?: boolean })?.requires_mfa).toBe(true);
    expect((res as { token?: string })?.token).toBe("");
  });

  it("Authenticate — MFA success with mfa_code", async () => {
    const userId = randomUUID();
    const email = `grpc-mfaok-${userId.slice(0, 8)}@example.com`;
    const passwordHash = await hashPassword("MfaPass!4");
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue({
      id: userId,
      email,
      passwordHash,
      mfaEnabled: true,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });
    vi.spyOn(mfaLib, "verifyMFA").mockResolvedValue(true);

    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        {
          request: {
            email,
            password: "MfaPass!4",
            mfa_code: "123456",
          },
        },
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { token?: string; requires_mfa?: boolean })?.token).toBeTruthy();
    expect((res as { requires_mfa?: boolean })?.requires_mfa).toBe(false);
  });

  it("ValidateToken — success (no jti, user found)", async () => {
    const userId = randomUUID();
    const email = `grpc-val-${userId.slice(0, 8)}@example.com`;
    const token = signJwt({ sub: userId, email });
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [
        {
          id: userId,
          email,
          createdAt: new Date(),
          isDeleted: false,
        },
      ] as never,
    );

    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeNull();
    expect((res as { valid?: boolean })?.valid).toBe(true);
    expect((res as { user?: { id: string } })?.user?.id).toBe(userId);
  });

  it("RefreshToken — success", async () => {
    const userId = randomUUID();
    const email = `grpc-ref-${userId.slice(0, 8)}@example.com`;
    const token = signJwt({ sub: userId, email });
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [{ id: userId, email, isDeleted: false }] as never,
    );

    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.RefreshToken(
        { request: { refresh_token: token } },
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { token?: string })?.token).toBeTruthy();
    expect((res as { token?: string })?.token).not.toBe(token);
  });

  it("healthWatch — interval writes health frame then end clears", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ ok: 1 }] as never);
    vi.stubGlobal(
      "setInterval",
      ((fn: TimerHandler) => {
        setTimeout(() => void (fn as () => void | Promise<void>)(), 0);
        return 99 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
    );
    vi.stubGlobal("clearInterval", vi.fn());
    const call = {
      write: vi.fn(),
      on: vi.fn((ev: string, fn: () => void) => {
        if (ev === "end") queueMicrotask(fn);
      }),
      end: vi.fn(),
    };
    try {
      grpcHandlersForTest.healthWatch(call);
      await new Promise<void>((r) => setTimeout(r, 40));
      expect(call.write).toHaveBeenCalled();
      const endFn = (call.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "end",
      )?.[1] as (() => void) | undefined;
      endFn?.();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("healthWatch — DB failure writes NOT_SERVING", async () => {
    const rawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("db down"));
    vi.stubGlobal(
      "setInterval",
      ((fn: TimerHandler) => {
        setTimeout(() => void (fn as () => void | Promise<void>)(), 0);
        return 98 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
    );
    vi.stubGlobal("clearInterval", vi.fn());
    const call = {
      write: vi.fn(),
      on: vi.fn((ev: string, fn: () => void) => {
        if (ev === "end") queueMicrotask(fn);
      }),
      end: vi.fn(),
    };
    try {
      grpcHandlersForTest.healthWatch(call);
      await new Promise<void>((r) => setTimeout(r, 40));
      expect(call.write).toHaveBeenCalledWith(
        expect.objectContaining({ status: 2 }),
      );
      const endFn = (call.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "end",
      )?.[1] as (() => void) | undefined;
      endFn?.();
    } finally {
      rawSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("healthWatch — write failure ends stream", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ ok: 1 }] as never);
    vi.stubGlobal(
      "setInterval",
      ((fn: TimerHandler) => {
        setTimeout(() => void (fn as () => void | Promise<void>)(), 0);
        return 97 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
    );
    vi.stubGlobal("clearInterval", vi.fn());
    const call = {
      write: vi.fn().mockImplementation(() => {
        throw new Error("sink closed");
      }),
      on: vi.fn((ev: string, fn: () => void) => {
        if (ev === "end") queueMicrotask(fn);
      }),
      end: vi.fn(),
    };
    try {
      grpcHandlersForTest.healthWatch(call);
      await new Promise<void>((r) => setTimeout(r, 40));
      expect(call.end).toHaveBeenCalled();
      const endFn = (call.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "end",
      )?.[1] as (() => void) | undefined;
      endFn?.();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Register — cache hit → ALREADY_EXISTS", async () => {
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(true);
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Register(
        {
          request: {
            email: `hit-${randomUUID()}@example.com`,
            password: "longpassword1",
          },
        },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.ALREADY_EXISTS);
  });

  it("Register — DB duplicate after cache miss → ALREADY_EXISTS", async () => {
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [{ id: randomUUID() }] as never,
    );
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Register(
        {
          request: {
            email: `dbdup-${randomUUID()}@example.com`,
            password: "longpassword1",
          },
        },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.ALREADY_EXISTS);
  });

  it("Authenticate — cache miss and empty DB → UNAUTHENTICATED", async () => {
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue(null);
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([] as never);
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        {
          request: {
            email: `miss-${randomUUID()}@example.com`,
            password: "any",
          },
        },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("Authenticate — wrong password → UNAUTHENTICATED", async () => {
    const userId = randomUUID();
    const email = `badpw-${userId.slice(0, 8)}@example.com`;
    const passwordHash = await hashPassword("RightPass!9");
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue({
      id: userId,
      email,
      passwordHash,
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        { request: { email, password: "WrongPass!9" } },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("Authenticate — corrupt hash throws compare → UNAUTHENTICATED", async () => {
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue({
      id: randomUUID(),
      email: "badhash@example.com",
      passwordHash: "not-a-valid-bcrypt-string",
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Authenticate(
        { request: { email: "badhash@example.com", password: "x" } },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code: number }).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("ValidateToken — USER_NOT_FOUND when prisma returns no row", async () => {
    const userId = randomUUID();
    const token = signJwt({ sub: userId, email: "nofind@example.com" });
    const redisSpy = vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const rawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue([] as never);
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeTruthy();
    const body = JSON.parse(String((err as { message?: string })?.message || "{}"));
    expect(body.code).toBe("USER_NOT_FOUND");
    rawSpy.mockRestore();
    redisSpy.mockRestore();
  });

  it("ValidateToken — ACCOUNT_DELETED when user is deleted", async () => {
    const userId = randomUUID();
    const token = signJwt({ sub: userId, email: "del@example.com" });
    const redisSpy = vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const rawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [
        {
          id: userId,
          email: "del@example.com",
          createdAt: new Date(),
          isDeleted: true,
        },
      ] as never,
    );
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeTruthy();
    const body = JSON.parse(String((err as { message?: string })?.message || "{}"));
    expect(body.code).toBe("ACCOUNT_DELETED");
    rawSpy.mockRestore();
    redisSpy.mockRestore();
  });

  it("HealthCheck — prisma failure → healthy false", async () => {
    const rawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValueOnce(new Error("db unreachable"));
    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.HealthCheck({ request: {} }, cb),
    );
    expect(err).toBeNull();
    expect((res as { healthy?: boolean })?.healthy).toBe(false);
    rawSpy.mockRestore();
  });

  it("healthV1Check — getQueueStatus throws → INTERNAL callback", async () => {
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const rawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ ok: 1 }] as never);
    const qSpy = vi
      .spyOn(bcryptQueue, "getQueueStatus")
      .mockImplementationOnce(() => {
        throw new Error("queue probe failed");
      });
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.healthV1Check({}, cb),
    );
    expect(err).toBeTruthy();
    expect((err as { code?: number }).code).toBe(grpc.status.INTERNAL);
    rawSpy.mockRestore();
    qSpy.mockRestore();
  });

  it("ValidateToken — TOKEN_REVOKED when jti is revoked", async () => {
    const jti = randomUUID();
    const userId = randomUUID();
    __testSeedRevokedJti(jti, 600);
    const token = signJwt({ sub: userId, email: "r@example.com", jti });
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeTruthy();
    const body = JSON.parse(String((err as { message?: string })?.message || "{}"));
    expect(body.code).toBe("TOKEN_REVOKED");
  });

  it("ValidateToken — isJtiRevoked rejects → continues to valid user", async () => {
    const userId = randomUUID();
    const token = signJwt({
      sub: userId,
      email: "cont@example.com",
      jti: randomUUID(),
    });
    const revSpy = vi
      .spyOn(revocation, "isJtiRevoked")
      .mockRejectedValueOnce(new Error("redis flake"));
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue({} as any);
    const rawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [
        {
          id: userId,
          email: "cont@example.com",
          createdAt: new Date(),
          isDeleted: false,
        },
      ] as never,
    );
    const { err, res } = await runCallback((cb) =>
      grpcHandlersForTest.ValidateToken({ request: { token } }, cb),
    );
    expect(err).toBeNull();
    expect((res as { valid?: boolean })?.valid).toBe(true);
    revSpy.mockRestore();
    rawSpy.mockRestore();
  });

  it("RefreshToken — TOKEN_REVOKED when jti is revoked", async () => {
    const jti = randomUUID();
    const userId = randomUUID();
    __testSeedRevokedJti(jti, 600);
    const token = signJwt({ sub: userId, email: "ref@example.com", jti });
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(null);
    const rawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [{ id: userId, email: "ref@example.com", isDeleted: false }] as never,
    );
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.RefreshToken({ request: { token } }, cb),
    );
    expect(err).toBeTruthy();
    const body = JSON.parse(String((err as { message?: string })?.message || "{}"));
    expect(body.code).toBe("TOKEN_REVOKED");
    rawSpy.mockRestore();
  });

  it("Register — INSERT prisma failure → INTERNAL", async () => {
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
    const email = `ins-${randomUUID()}@example.com`;
    vi.spyOn(prisma, "$queryRaw").mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const t = grpcSql(strings, values);
      if (t.includes("SELECT id FROM auth.users WHERE email")) {
        return Promise.resolve([] as never);
      }
      if (t.includes("INSERT INTO auth.users")) {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve([] as never);
    });
    const { err } = await runCallback((cb) =>
      grpcHandlersForTest.Register(
        { request: { email, password: "longpassword1" } },
        cb,
      ),
    );
    expect(err).toBeTruthy();
    expect((err as { code?: number }).code).toBe(grpc.status.INTERNAL);
  });

  it("grpcWithLogging — metadata getMap throws; handler still runs", async () => {
    const handler = vi.fn(async (_call: unknown, cb: (e: unknown, r?: unknown) => void) => {
      cb(null, { ok: true });
    });
    const wrapped = grpcWithLoggingForTest(handler, "MetaOk");
    const { err, res } = await runCallback((cb) =>
      wrapped(
        {
          metadata: {
            getMap: () => {
              throw new Error("bad meta");
            },
          },
          getPeer: () => "p",
          host: "h",
        },
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { ok?: boolean })?.ok).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

});
