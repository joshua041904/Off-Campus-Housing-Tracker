/**
 * Supertest coverage for `routes/mfa.ts` (mounted router, mocked lib + Prisma).
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "@common/utils/auth";
import { setupMFARoutes } from "../src/routes/mfa.js";
import { prisma } from "../src/lib/prisma.js";
import * as mfaLib from "../src/lib/mfa.js";

const userId = randomUUID();

function authHeader(): { Authorization: string } {
  const token = signJwt({ sub: userId, email: "user@example.com" });
  return { Authorization: `Bearer ${token}` };
}

describe("MFA routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/mfa", setupMFARoutes(prisma));

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(mfaLib, "setupMFA").mockReset();
    vi.spyOn(mfaLib, "verifyMFA").mockReset();
    vi.spyOn(mfaLib, "enableMFA").mockReset().mockResolvedValue(undefined);
    vi.spyOn(mfaLib, "disableMFA").mockReset().mockResolvedValue(undefined);
  });

  it("POST /mfa/setup — 401 without Authorization", async () => {
    await request(app).post("/mfa/setup").expect(401);
  });

  it("POST /mfa/setup — 401 invalid JWT", async () => {
    await request(app)
      .post("/mfa/setup")
      .set({ Authorization: "Bearer not-a-jwt" })
      .expect(401);
  });

  it("POST /mfa/setup — 200", async () => {
    mfaLib.setupMFA.mockResolvedValueOnce({
      secret: "s",
      qrCode: "",
      backupCodes: ["A", "B"],
    });
    const res = await request(app).post("/mfa/setup").set(authHeader()).expect(200);
    expect(res.body.secret).toBe("s");
    expect(res.body.backupCodes).toEqual(["A", "B"]);
    expect(mfaLib.setupMFA).toHaveBeenCalledTimes(1);
    const setupArgs = vi.mocked(mfaLib.setupMFA).mock.calls[0]!;
    expect(setupArgs[1]).toBe(userId);
    expect(setupArgs[2]).toBe("user@example.com");
  });

  it("POST /mfa/setup — 500 when setupMFA throws", async () => {
    mfaLib.setupMFA.mockRejectedValueOnce(new Error("db"));
    await request(app).post("/mfa/setup").set(authHeader()).expect(500);
  });

  it("POST /mfa/verify — 400 without code", async () => {
    await request(app).post("/mfa/verify").set(authHeader()).send({}).expect(400);
  });

  it("POST /mfa/verify — 401 when verifyMFA false", async () => {
    mfaLib.verifyMFA.mockResolvedValueOnce(false);
    await request(app)
      .post("/mfa/verify")
      .set(authHeader())
      .send({ code: "123456" })
      .expect(401);
    expect(mfaLib.enableMFA).not.toHaveBeenCalled();
  });

  it("POST /mfa/verify — 200 and calls enableMFA", async () => {
    mfaLib.verifyMFA.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/mfa/verify")
      .set(authHeader())
      .send({ code: "123456" })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(mfaLib.enableMFA).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mfaLib.enableMFA).mock.calls[0]![1]).toBe(userId);
  });

  it("POST /mfa/verify — 500 when enableMFA throws", async () => {
    mfaLib.verifyMFA.mockResolvedValueOnce(true);
    mfaLib.enableMFA.mockRejectedValueOnce(new Error("tx"));
    await request(app)
      .post("/mfa/verify")
      .set(authHeader())
      .send({ code: "123456" })
      .expect(500);
  });

  it("POST /mfa/disable — 400 when MFA enabled and code omitted", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ mfa_enabled: true }] as never);
    await request(app)
      .post("/mfa/disable")
      .set(authHeader())
      .send({})
      .expect(400);
    expect(mfaLib.disableMFA).not.toHaveBeenCalled();
  });

  it("POST /mfa/disable — 401 when MFA enabled and code invalid", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ mfa_enabled: true }] as never);
    mfaLib.verifyMFA.mockResolvedValueOnce(false);
    await request(app)
      .post("/mfa/disable")
      .set(authHeader())
      .send({ code: "bad" })
      .expect(401);
  });

  it("POST /mfa/disable — 200 when MFA enabled and code valid", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ mfa_enabled: true }] as never);
    mfaLib.verifyMFA.mockResolvedValueOnce(true);
    await request(app)
      .post("/mfa/disable")
      .set(authHeader())
      .send({ code: "ok" })
      .expect(200);
    expect(mfaLib.disableMFA).toHaveBeenCalled();
  });

  it("POST /mfa/disable — 200 idempotent when MFA not enabled (no code)", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ mfa_enabled: false }] as never);
    await request(app).post("/mfa/disable").set(authHeader()).send({}).expect(200);
    expect(mfaLib.verifyMFA).not.toHaveBeenCalled();
    expect(mfaLib.disableMFA).toHaveBeenCalled();
  });

  it("POST /mfa/disable — 500 on unexpected error", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("db"));
    await request(app).post("/mfa/disable").set(authHeader()).send({ code: "x" }).expect(500);
  });

  it("POST /mfa/verify-login — 400 missing fields", async () => {
    await request(app).post("/mfa/verify-login").send({}).expect(400);
  });

  it("POST /mfa/verify-login — 401 invalid code", async () => {
    mfaLib.verifyMFA.mockResolvedValueOnce(false);
    await request(app)
      .post("/mfa/verify-login")
      .send({ userId, code: "000000" })
      .expect(401);
  });

  it("POST /mfa/verify-login — 200", async () => {
    mfaLib.verifyMFA.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/mfa/verify-login")
      .send({ userId, code: "111111" })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(mfaLib.verifyMFA).toHaveBeenCalledTimes(1);
    const vargs = vi.mocked(mfaLib.verifyMFA).mock.calls[0]!;
    expect(vargs[1]).toBe(userId);
    expect(vargs[2]).toBe("111111");
  });

  it("POST /mfa/verify-login — 500 when verifyMFA throws", async () => {
    mfaLib.verifyMFA.mockRejectedValueOnce(new Error("boom"));
    await request(app)
      .post("/mfa/verify-login")
      .send({ userId, code: "111111" })
      .expect(500);
  });
});
