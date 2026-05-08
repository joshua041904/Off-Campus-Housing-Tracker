import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { Express } from "express";
import { hashPassword } from "../src/lib/bcrypt-queue";
import { prisma } from "../src/lib/prisma";
import * as redisCache from "../src/lib/redis-cache";
import {
  __testClearRevocationMemory,
  __testSeedRevokedJti,
} from "../src/lib/revocation.js";

function sqlText(
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

describe(
  "M2 HTTP happy paths (register → login → validate → logout → refresh → account)",
  { timeout: 30_000 },
  () => {
  let app: Express;

  beforeAll(async () => {
    const mod = await import("../src/server");
    app = mod.app;
  });

  afterEach(() => {
    __testClearRevocationMemory();
    vi.restoreAllMocks();
  });

  it("full chain with Prisma + Redis revocation branches", async () => {
    const userId = randomUUID();
    const email = `m2-${userId.slice(0, 8)}@example.com`;
    const password = "M2SecurePass!9";
    const passwordHash = await hashPassword(password);

    vi.spyOn(prisma, "$queryRaw").mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const t = sqlText(strings, values);
        if (t.includes("INSERT INTO auth.users")) {
          return Promise.resolve([
            { id: userId, email, created_at: new Date() },
          ]);
        }
        if (
          t.includes("SELECT id, email FROM auth.users") &&
          t.includes("WHERE email")
        ) {
          return Promise.resolve([]);
        }
        if (t.includes("password_hash") && t.includes("WHERE email")) {
          return Promise.resolve([
            {
              id: userId,
              email,
              passwordHash,
              mfaEnabled: false,
              emailVerified: true,
              phoneVerified: false,
              createdAt: new Date(),
              isDeleted: false,
            },
          ]);
        }
        if (
          t.includes("created_at") &&
          t.includes("as is_deleted") &&
          t.includes("WHERE id")
        ) {
          return Promise.resolve([
            {
              id: userId,
              email,
              created_at: new Date(),
              is_deleted: false,
            },
          ]);
        }
        if (
          t.includes("SELECT id, email, COALESCE(is_deleted") &&
          t.includes("WHERE id")
        ) {
          return Promise.resolve([
            { id: userId, email, is_deleted: false },
          ]);
        }
        if (
          t.includes("SELECT email, COALESCE(is_deleted") &&
          t.includes("FROM auth.users WHERE id") &&
          !t.includes("FOR UPDATE")
        ) {
          return Promise.resolve([{ email, is_deleted: false }]);
        }
        return Promise.resolve([]);
      },
    );

    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn: unknown) => {
      const tx = {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([{ email, is_deleted: false }]),
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    });

    vi.spyOn(redisCache, "invalidateUserCache").mockResolvedValue();
    vi.spyOn(redisCache, "checkEmailExistsInCache").mockResolvedValue(false);
    vi.spyOn(redisCache, "cacheUser").mockResolvedValue();
    vi.spyOn(redisCache, "getUserFromCache").mockResolvedValue(null);

    const reg = await request(app).post("/register").send({
      email,
      password,
      sendVerification: false,
    });
    expect(reg.status).toBe(201);
    expect(reg.body?.token).toBeTruthy();
    const tokenAfterRegister = reg.body.token as string;

    const val1 = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${tokenAfterRegister}`);
    expect(val1.status).toBe(200);
    expect(val1.body?.valid).toBe(true);
    expect(val1.body?.user?.id).toBe(userId);

    const out = await request(app)
      .post("/logout")
      .set("Authorization", `Bearer ${tokenAfterRegister}`);
    expect(out.status).toBe(200);
    expect(out.body?.revoked).toBe(true);

    const valRevoked = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${tokenAfterRegister}`);
    expect(valRevoked.status).toBe(401);
    expect(valRevoked.body?.code).toBe("TOKEN_REVOKED");

    const login = await request(app).post("/login").send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body?.token).toBeTruthy();
    const tokenAfterLogin = login.body.token as string;

    const ref = await request(app)
      .post("/refresh")
      .set("Authorization", `Bearer ${tokenAfterLogin}`);
    expect(ref.status).toBe(200);
    expect(ref.body?.token).toBeTruthy();

    const del = await request(app)
      .delete("/account")
      .set("Authorization", `Bearer ${tokenAfterLogin}`);
    expect(del.status).toBe(202);
    expect(del.body?.status).toBe("accepted");
  });

  it("POST /validate — revoked jti → TOKEN_REVOKED", async () => {
    const userId = randomUUID();
    const jti = randomUUID();
    const secret = process.env.JWT_SECRET || "dev";
    const token = jwt.sign(
      { sub: userId, email: "rev@example.com", jti },
      secret,
      { expiresIn: "10m", algorithm: "HS256" },
    );

    __testSeedRevokedJti(jti, 120);

    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [] as never,
    );

    const res = await request(app)
      .post("/validate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("TOKEN_REVOKED");
  });

  it("GET /me — valid JWT and prisma profile → 200 with flags", async () => {
    const userId = randomUUID();
    const email = `me-${userId.slice(0, 8)}@example.com`;
    const token = jwt.sign(
      { sub: userId, email },
      process.env.JWT_SECRET || "dev",
      { expiresIn: "15m", algorithm: "HS256" },
    );

    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(
      [
        {
          email_verified: true,
          phone_verified: false,
          mfa_enabled: true,
          is_deleted: false,
          display_username: "u_me",
        },
      ] as never,
    );

    const res = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body?.sub).toBe(userId);
    expect(res.body?.emailVerified).toBe(true);
    expect(res.body?.mfaEnabled).toBe(true);
    expect(res.body?.display_username).toBe("u_me");
  });
});
