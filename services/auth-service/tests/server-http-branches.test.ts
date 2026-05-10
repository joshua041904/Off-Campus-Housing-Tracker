import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { Express } from "express";
import { signJwt } from "@common/utils/auth";
import { prisma } from "../src/lib/prisma";
import * as redisCache from "../src/lib/redis-cache.js";
import {
  __testClearRevocationMemory,
  __testSeedRevokedJti,
} from "../src/lib/revocation.js";
import * as revocation from "../src/lib/revocation.js";
import { authServiceRedisClient } from "../src/server";

function tplJoin(strings: unknown): string {
  if (strings == null) return "";
  if (typeof strings === "object" && Symbol.iterator in (strings as object)) {
    return Array.from(strings as Iterable<string>).join("");
  }
  return String(strings);
}

describe("server.ts branch coverage (HTTP)", () => {
  let app: Express;

  beforeAll(async () => {
    const mod = await import("../src/server");
    app = mod.app;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    __testClearRevocationMemory();
    vi.restoreAllMocks();
  });

  it("GET /__test/throw hits error middleware → 500 INTERNAL_ERROR", async () => {
    const res = await request(app).get("/__test/throw");
    expect(res.status).toBe(500);
    expect(res.body?.code).toBe("INTERNAL_ERROR");
  });

  it("GET /healthz returns 200 with shape (db/redis may be disconnected)", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(["connected", "disconnected"]).toContain(res.body?.db);
    expect(["connected", "disconnected"]).toContain(res.body?.redis);
    expect(res.body?.bcrypt).toBeDefined();
    expect(res.body?.cache).toBeDefined();
  });

  it("GET /healthz — DB failure (non-timeout) logs warn and marks db disconnected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("relation auth.users missing"));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.db).toBe("disconnected");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("healthz db"))).toBe(true);
    warn.mockRestore();
  });

  it("GET /healthz — DB timeout path does not log healthz db warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(prisma, "$queryRaw").mockImplementationOnce(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("DB check timeout")), 800),
        ),
    );
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.db).toBe("disconnected");
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("healthz db")),
    ).toHaveLength(0);
    warn.mockRestore();
  });

  it("GET /healthz — Redis ping failure (non-timeout) logs healthz_redis_ping_failed", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(authServiceRedisClient, "ping").mockRejectedValueOnce(new Error("redis refused"));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.redis).toBe("disconnected");
    expect(
      log.mock.calls.some((c) => String(c[0]).includes("healthz_redis_ping_failed")),
    ).toBe(true);
    log.mockRestore();
  });

  it("GET /healthz — Redis ping timeout marks redis disconnected (no healthz_redis log)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(authServiceRedisClient, "ping").mockImplementation(
      () => new Promise(() => {}),
    );
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.redis).toBe("disconnected");
    expect(
      log.mock.calls.filter((c) => String(c[0]).includes("healthz_redis")),
    ).toHaveLength(0);
    log.mockRestore();
  });

  it("GET /healthz — getCacheStats slow path returns stale cache object", async () => {
    vi.spyOn(redisCache, "getCacheStats").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                connected: true,
                userCacheKeys: 99,
              } as never),
            900,
          ),
        ),
    );
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.cache?.connected).toBe(false);
    expect(res.body?.cache?.userCacheKeys).toBe(0);
  });

  it("GET /metrics returns Prometheus / OpenMetrics payload", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    const ct = String(res.headers["content-type"] || "");
    expect(
      ct.includes("text/plain") || ct.includes("openmetrics-text"),
    ).toBe(true);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("POST /register — email only → VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/register")
      .send({ email: "only@email.com" });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /register — password only → VALIDATION_ERROR", async () => {
    const res = await request(app).post("/register").send({ password: "secret" });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /register — prisma failure → INTERNAL_ERROR", async () => {
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("forced db failure"));
    const res = await request(app).post("/register").send({
      email: `branch-${randomUUID()}@example.com`,
      password: "longpassword123",
      sendVerification: false,
    });
    expect(res.status).toBe(500);
    expect(res.body?.code).toBe("INTERNAL_ERROR");
  });

  it("POST /login — missing fields → VALIDATION_ERROR", async () => {
    const res = await request(app).post("/login").send({});
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /login — email only → VALIDATION_ERROR", async () => {
    const res = await request(app).post("/login").send({ email: "a@b.co" });
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("VALIDATION_ERROR");
  });

  it("POST /login — unknown user → INVALID_CREDENTIALS", async () => {
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue(null);
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([] as never);
    const res = await request(app).post("/login").send({
      email: `nouser-${randomUUID()}@example.com`,
      password: "doesnotmatter999",
    });
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_CREDENTIALS");
  });

  it("POST /login — prisma throws with credential-like message → INVALID_CREDENTIALS", async () => {
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue(null);
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(
      Object.assign(new Error("invalid credentials"), { code: "P2025" }),
    );
    const res = await request(app).post("/login").send({
      email: "any@example.com",
      password: "pw",
    });
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_CREDENTIALS");
  });

  it("POST /login — prisma throws generic → INTERNAL_ERROR", async () => {
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue(null);
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (!t.includes("auth.users")) {
        return Promise.resolve([] as never);
      }
      return Promise.reject(
        new Error("ECONNRESET: upstream database connection reset"),
      );
    });
    const res = await request(app).post("/login").send({
      email: `disk-${randomUUID()}@example.com`,
      password: "pw",
    });
    expect(res.status).toBe(500);
    expect(res.body?.code).toBe("INTERNAL_ERROR");
  });

  it("POST /logout — no Authorization → 200 revoked false", async () => {
    const res = await request(app).post("/logout");
    expect(res.status).toBe(200);
    expect(res.body?.revoked).toBe(false);
  });

  it("POST /logout — malformed JWT → 200 revoked false", async () => {
    const res = await request(app)
      .post("/logout")
      .set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(200);
    expect(res.body?.revoked).toBe(false);
  });

  it("POST /logout — expired JWT → 200 revoked false", async () => {
    const secret = process.env.JWT_SECRET || "dev";
    const expired = jwt.sign(
      { sub: randomUUID(), email: "e@e.com", jti: randomUUID() },
      secret,
      { expiresIn: "-120s" },
    );
    const res = await request(app)
      .post("/logout")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(200);
    expect(res.body?.revoked).toBe(false);
  });

  it("POST /logout — setJtiRevoked throws → 200 revoked false + Redis unavailable", async () => {
    const jti = randomUUID();
    const token = signJwt({
      sub: randomUUID(),
      email: "lo@example.com",
      jti,
    });
    vi.spyOn(revocation, "setJtiRevoked").mockRejectedValueOnce(
      new Error("redis unavailable"),
    );
    const res = await request(app)
      .post("/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body?.revoked).toBe(false);
    expect(String(res.body?.error || "")).toMatch(/Redis|unavailable/i);
  });

  it("POST /logout — valid JWT without jti → revoked false", async () => {
    const token = jwt.sign(
      { sub: randomUUID(), email: "nj@example.com" },
      process.env.JWT_SECRET || "dev",
      { expiresIn: "1h" },
    );
    const res = await request(app)
      .post("/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body?.revoked).toBe(false);
  });

  it("POST /validate — missing Authorization → MISSING_TOKEN", async () => {
    const res = await request(app).post("/validate");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("MISSING_TOKEN");
  });

  it("POST /validate — garbage token → INVALID_TOKEN", async () => {
    const res = await request(app)
      .post("/validate")
      .set("Authorization", "Bearer x.y.z");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_TOKEN");
  });

  it("POST /validate — expired token → EXPIRED_TOKEN", async () => {
    const secret = process.env.JWT_SECRET || "dev";
    const expired = jwt.sign(
      { sub: randomUUID(), email: "e@e.com", jti: randomUUID() },
      secret,
      { expiresIn: "-120s" },
    );
    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("EXPIRED_TOKEN");
  });

  it("POST /validate — TOKEN_REVOKED when jti is revoked", async () => {
    const uid = randomUUID();
    const jti = randomUUID();
    __testSeedRevokedJti(jti, 300);
    const token = signJwt({ sub: uid, email: "rv@example.com", jti });
    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("TOKEN_REVOKED");
  });

  it("POST /validate — USER_NOT_FOUND when user row missing", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "nf@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("FROM auth.users") &&
        t.includes("WHERE id") &&
        t.includes("created_at")
      ) {
        return Promise.resolve([] as never);
      }
      return Promise.resolve([] as never);
    });
    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("USER_NOT_FOUND");
  });

  it("POST /validate — ACCOUNT_DELETED when user is_deleted", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "del@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("FROM auth.users") &&
        t.includes("WHERE id") &&
        t.includes("created_at")
      ) {
        return Promise.resolve([
          {
            id: uid,
            email: "del@example.com",
            created_at: new Date(),
            is_deleted: true,
          },
        ] as never);
      }
      return Promise.resolve([] as never);
    });
    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("ACCOUNT_DELETED");
  });

  it("POST /validate — prisma error → INTERNAL_ERROR", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "db@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(
      new Error("connection reset"),
    );
    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body?.code).toBe("INTERNAL_ERROR");
  });

  it("POST /validate — valid JWT, no sub in payload → INVALID_TOKEN", async () => {
    const token = jwt.sign(
      { email: "only@email.com", jti: randomUUID() },
      process.env.JWT_SECRET || "dev",
      { expiresIn: "1h", algorithm: "HS256" },
    );
    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_TOKEN");
  });

  it("POST /refresh — missing token → MISSING_TOKEN", async () => {
    const res = await request(app).post("/refresh");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("MISSING_TOKEN");
  });

  it("POST /refresh — TOKEN_REVOKED when jti revoked", async () => {
    const uid = randomUUID();
    const jti = randomUUID();
    __testSeedRevokedJti(jti, 300);
    const token = signJwt({ sub: uid, email: "rfr@example.com", jti });
    const res = await request(app)
      .post("/refresh")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("TOKEN_REVOKED");
  });

  it("POST /refresh — USER_NOT_FOUND", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "rfn@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("FROM auth.users") &&
        t.includes("WHERE id") &&
        !t.includes("created_at")
      ) {
        return Promise.resolve([] as never);
      }
      return Promise.resolve([] as never);
    });
    const res = await request(app)
      .post("/refresh")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("USER_NOT_FOUND");
  });

  it("POST /refresh — ACCOUNT_DELETED", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "rfd@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("FROM auth.users") &&
        t.includes("WHERE id") &&
        !t.includes("created_at")
      ) {
        return Promise.resolve([
          { id: uid, email: "rfd@example.com", is_deleted: true },
        ] as never);
      }
      return Promise.resolve([] as never);
    });
    const res = await request(app)
      .post("/refresh")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("ACCOUNT_DELETED");
  });

  it("POST /refresh — prisma error → INTERNAL_ERROR", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "rfe@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    const res = await request(app)
      .post("/refresh")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body?.code).toBe("INTERNAL_ERROR");
  });

  it("POST /refresh — expired token → EXPIRED_TOKEN", async () => {
    const secret = process.env.JWT_SECRET || "dev";
    const expired = jwt.sign(
      { sub: randomUUID(), email: "e@e.com", jti: randomUUID() },
      secret,
      { expiresIn: "-120s" },
    );
    const res = await request(app)
      .post("/refresh")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("EXPIRED_TOKEN");
  });

  it("DELETE /account — missing Authorization → MISSING_TOKEN", async () => {
    const res = await request(app).delete("/account");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("MISSING_TOKEN");
  });

  it("DELETE /account — invalid JWT → INVALID_TOKEN", async () => {
    const res = await request(app)
      .delete("/account")
      .set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_TOKEN");
  });

  it("DELETE /account — transaction returns already_deleted → 202", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "ad@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("SELECT email") &&
        t.includes("FROM auth.users WHERE id") &&
        !t.includes("FOR UPDATE")
      ) {
        return Promise.resolve([{ email: "ad@example.com", is_deleted: false }] as never);
      }
      return Promise.resolve([] as never);
    });
    vi.spyOn(prisma, "$transaction").mockResolvedValueOnce({
      kind: "already_deleted" as const,
    } as never);
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(202);
    expect(res.body?.status).toBe("already_deleted");
  });

  it("DELETE /account — transaction returns notfound → 404", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "nf2@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("SELECT email") &&
        t.includes("FROM auth.users WHERE id") &&
        !t.includes("FOR UPDATE")
      ) {
        return Promise.resolve([{ email: "nf2@example.com", is_deleted: false }] as never);
      }
      return Promise.resolve([] as never);
    });
    vi.spyOn(prisma, "$transaction").mockResolvedValueOnce({
      kind: "notfound" as const,
    } as never);
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe("USER_NOT_FOUND");
  });

  it("DELETE /account — redis revoke after delete logs warn but returns 202", async () => {
    const uid = randomUUID();
    const jti = randomUUID();
    const token = signJwt({ sub: uid, email: "rw@example.com", jti });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("SELECT email") &&
        t.includes("FROM auth.users WHERE id") &&
        !t.includes("FOR UPDATE")
      ) {
        return Promise.resolve([{ email: "rw@example.com", is_deleted: false }] as never);
      }
      return Promise.resolve([] as never);
    });
    vi.spyOn(prisma, "$transaction").mockResolvedValueOnce({
      kind: "accepted" as const,
      eventId: randomUUID(),
      emailWas: "rw@example.com",
    } as never);
    vi.spyOn(redisCache, "invalidateUserCache").mockResolvedValue();
    vi.spyOn(revocation, "setJtiRevoked").mockResolvedValue();
    vi.spyOn(revocation, "setUserDeletedMarker").mockRejectedValueOnce(
      new Error("redis flake"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(202);
    expect(res.body?.status).toBe("accepted");
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("redis revoke after delete"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("DELETE /account — user row already is_deleted → 202 already_deleted", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "pre@example.com", jti: randomUUID() });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("SELECT email") &&
        t.includes("FROM auth.users WHERE id") &&
        !t.includes("FOR UPDATE")
      ) {
        return Promise.resolve([{ email: null, is_deleted: true }] as never);
      }
      return Promise.resolve([] as never);
    });
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(202);
    expect(res.body?.status).toBe("already_deleted");
  });

  it("DELETE /account — TOKEN_REVOKED when jti revoked", async () => {
    const uid = randomUUID();
    const jti = randomUUID();
    __testSeedRevokedJti(jti, 300);
    const token = signJwt({ sub: uid, email: "tr@example.com", jti });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("SELECT email") &&
        t.includes("FROM auth.users WHERE id") &&
        !t.includes("FOR UPDATE")
      ) {
        return Promise.resolve([{ email: "tr@example.com", is_deleted: false }] as never);
      }
      return Promise.resolve([] as never);
    });
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("TOKEN_REVOKED");
  });

  it("DELETE /account — prisma $transaction rejects → INTERNAL_ERROR", async () => {
    const uid = randomUUID();
    const token = signJwt({
      sub: uid,
      email: "txfail@example.com",
      jti: randomUUID(),
    });
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (
        t.includes("FROM auth.users WHERE id") &&
        !t.includes("FOR UPDATE")
      ) {
        return Promise.resolve([
          { email: "txfail@example.com", is_deleted: false },
        ] as never);
      }
      return Promise.resolve([] as never);
    });
    const txSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("deadlock detected"));
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body?.code).toBe("INTERNAL_ERROR");
    txSpy.mockRestore();
  });

  it("DELETE /account — expired JWT → EXPIRED_TOKEN", async () => {
    const secret = process.env.JWT_SECRET || "dev";
    const expired = jwt.sign(
      { sub: randomUUID(), email: "e@e.com", jti: randomUUID() },
      secret,
      { expiresIn: "-120s" },
    );
    const res = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("EXPIRED_TOKEN");
  });

  it("GET /me — missing Authorization → MISSING_TOKEN", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("MISSING_TOKEN");
  });

  it("POST /login — comparePassword throws → INVALID_CREDENTIALS", async () => {
    const uid = randomUUID();
    const email = `cpthrow-${uid.slice(0, 8)}@example.com`;
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue({
      id: uid,
      email,
      passwordHash: "$2b$04$abcdefghijklmnopqrstuv",
      mfaEnabled: false,
      emailVerified: true,
      phoneVerified: false,
      createdAt: new Date(),
    });
    const bp = await import("../src/lib/bcrypt-queue.js");
    vi.spyOn(bp, "comparePassword").mockRejectedValue(new Error("compare blew"));
    const res = await request(app).post("/login").send({
      email,
      password: "any-password",
    });
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_CREDENTIALS");
  });

  it("GET /privacy returns HTML", async () => {
    const res = await request(app).get("/privacy");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"] || "")).toContain("html");
    expect(res.text).toContain("Privacy Policy");
  });

  it("GET /terms returns HTML", async () => {
    const res = await request(app).get("/terms");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"] || "")).toContain("html");
    expect(res.text).toContain("Terms of Service");
  });

  it("GET /me — malformed JWT → INVALID_TOKEN", async () => {
    const res = await request(app)
      .get("/me")
      .set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("INVALID_TOKEN");
  });

  it("GET /me — expired JWT → EXPIRED_TOKEN", async () => {
    const secret = process.env.JWT_SECRET || "dev";
    const expired = jwt.sign(
      { sub: randomUUID(), email: "e@e.com" },
      secret,
      { expiresIn: "-120s" },
    );
    const res = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("EXPIRED_TOKEN");
  });

  it("GET /me — valid JWT, prisma rejects → falls back to payload JSON", async () => {
    const uid = randomUUID();
    const token = signJwt({ sub: uid, email: "fallback@example.com" });
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db read failed"));
    const res = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body?.sub).toBe(uid);
  });

  it("POST /register — cache hit → EMAIL_ALREADY_EXISTS", async () => {
    const email = `cached-${randomUUID()}@example.com`;
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(true);
    const res = await request(app).post("/register").send({
      email,
      password: "longpassword12",
      sendVerification: false,
    });
    expect(res.status).toBe(409);
    expect(res.body?.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("POST /register — DB duplicate (cache miss) → EMAIL_ALREADY_EXISTS", async () => {
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
    const dupEmail = `dup-${randomUUID()}@example.com`;
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (!t.includes("auth.users")) {
        return Promise.resolve([] as never);
      }
      if (t.includes("SELECT id, email FROM auth.users")) {
        return Promise.resolve([
          { id: randomUUID(), email: dupEmail },
        ] as never);
      }
      return Promise.reject(new Error("unexpected register query"));
    });
    const res = await request(app).post("/register").send({
      email: dupEmail,
      password: "longpassword12",
      sendVerification: false,
    });
    expect(res.status).toBe(409);
    expect(res.body?.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it(
    "POST /register — slow bcrypt logs warning when hash exceeds 5s",
    async () => {
      const bp = await import("../src/lib/bcrypt-queue.js");
      vi.spyOn(bp, "hashPassword").mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve("$2b$04$abcdefghijklmnopqrstuv"),
              5100,
            );
          }),
      );
      vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
      vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
      const rawSpy = vi.spyOn(prisma, "$queryRaw").mockImplementation(
        (strings: unknown, ..._values: unknown[]) => {
          const t = tplJoin(strings);
          if (
            t.includes("SELECT id, email FROM auth.users") &&
            t.includes("WHERE email")
          ) {
            return Promise.resolve([] as never);
          }
          if (t.includes("INSERT INTO auth.users")) {
            return Promise.resolve([
              {
                id: randomUUID(),
                email: "slowwall@example.com",
                created_at: new Date(),
              },
            ] as never);
          }
          return Promise.resolve([] as never);
        },
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await request(app)
        .post("/register")
        .send({
          email: `slowwall-${randomUUID()}@example.com`,
          password: "longpassword12",
          sendVerification: false,
        });
      expect(res.status).toBe(201);
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes("Slow bcrypt")),
      ).toBe(true);
      warnSpy.mockRestore();
      rawSpy.mockRestore();
    },
    12_000,
  );

  it("POST /register — sendVerification throws but user is created (201)", async () => {
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
    const email = `ver-${randomUUID()}@example.com`;
    const newId = randomUUID();
    vi.spyOn(prisma, "$queryRaw").mockImplementation((strings: unknown) => {
      const t = tplJoin(strings);
      if (!t.includes("auth.users")) {
        return Promise.resolve([] as never);
      }
      if (t.includes("SELECT id, email FROM auth.users")) {
        return Promise.resolve([] as never);
      }
      if (t.includes("INSERT INTO auth.users")) {
        return Promise.resolve([
          { id: newId, email, created_at: new Date() },
        ] as never);
      }
      return Promise.resolve([] as never);
    });
    const ver = await import("../src/lib/verification.js");
    vi.spyOn(ver, "sendEmailVerificationCode").mockRejectedValue(
      new Error("smtp unavailable"),
    );
    const res = await request(app).post("/register").send({
      email,
      password: "longpassword12",
      sendVerification: true,
    });
    expect(res.status).toBe(201);
    expect(res.body?.token).toBeTruthy();
    expect(res.body?.emailVerified).toBe(false);
  });
});
