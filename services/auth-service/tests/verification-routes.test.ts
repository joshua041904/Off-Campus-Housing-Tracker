/**
 * Supertest coverage for `routes/verification.ts`.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "@common/utils/auth";
import { setupVerificationRoutes } from "../src/routes/verification.js";
import * as verificationLib from "../src/lib/verification.js";
import { prisma } from "../src/lib/prisma.js";

const userId = randomUUID();

function authHeader(): { Authorization: string } {
  const token = signJwt({ sub: userId, email: "user@example.com" });
  return { Authorization: `Bearer ${token}` };
}

describe("verification routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/verify", setupVerificationRoutes(prisma));

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(verificationLib, "sendEmailVerificationCode").mockReset();
    vi.spyOn(verificationLib, "sendSmsVerificationCode").mockReset();
    vi.spyOn(verificationLib, "verifyVerificationCode").mockReset();
  });

  it("POST /verify/email/send — 400 without email", async () => {
    await request(app).post("/verify/email/send").send({}).expect(400);
  });

  it("POST /verify/email/send — 503 when not configured", async () => {
    verificationLib.sendEmailVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "Email service not configured",
    });
    const res = await request(app)
      .post("/verify/email/send")
      .send({ email: "a@b.com" })
      .expect(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("POST /verify/email/send — 503 when message mentions SMTP", async () => {
    verificationLib.sendEmailVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "SMTP_HOST is wrong",
    });
    await request(app).post("/verify/email/send").send({ email: "a@b.com" }).expect(503);
  });

  it("POST /verify/email/send — 500 generic failure", async () => {
    verificationLib.sendEmailVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "rate limited",
    });
    const res = await request(app)
      .post("/verify/email/send")
      .send({ email: "a@b.com" })
      .expect(500);
    expect(res.body.error).toContain("rate");
  });

  it("POST /verify/email/send — 200 with optional auth user id", async () => {
    verificationLib.sendEmailVerificationCode.mockResolvedValueOnce({ success: true });
    await request(app)
      .post("/verify/email/send")
      .set(authHeader())
      .send({ email: "x@y.com" })
      .expect(200);
    expect(verificationLib.sendEmailVerificationCode).toHaveBeenCalledTimes(1);
    const args = vi.mocked(verificationLib.sendEmailVerificationCode).mock.calls[0]!;
    expect(args[1]).toBe(userId);
    expect(args[2]).toBe("x@y.com");
  });

  it("POST /verify/email/send — 500 catch SMTP-shaped error", async () => {
    verificationLib.sendEmailVerificationCode.mockRejectedValueOnce(new Error("SMTP_HOST missing"));
    await request(app).post("/verify/email/send").send({ email: "a@b.com" }).expect(503);
  });

  it("POST /verify/email/send — 500 catch generic", async () => {
    verificationLib.sendEmailVerificationCode.mockRejectedValueOnce(new Error("db"));
    await request(app).post("/verify/email/send").send({ email: "a@b.com" }).expect(500);
  });

  it("POST /verify/email/verify — 400 missing fields", async () => {
    await request(app).post("/verify/email/verify").send({ email: "a@b.com" }).expect(400);
  });

  it("POST /verify/email/verify — 400 failed verify", async () => {
    verificationLib.verifyVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "bad",
    });
    const res = await request(app)
      .post("/verify/email/verify")
      .send({ email: "a@b.com", code: "111111" })
      .expect(400);
    expect(res.body.error).toBe("bad");
  });

  it("POST /verify/email/verify — 200", async () => {
    verificationLib.verifyVerificationCode.mockResolvedValueOnce({
      success: true,
      userId: "u-out",
    });
    const res = await request(app)
      .post("/verify/email/verify")
      .send({ email: "a@b.com", code: "111111" })
      .expect(200);
    expect(res.body.userId).toBe("u-out");
  });

  it("POST /verify/email/verify — 500 on throw", async () => {
    verificationLib.verifyVerificationCode.mockRejectedValueOnce(new Error("db"));
    await request(app)
      .post("/verify/email/verify")
      .send({ email: "a@b.com", code: "1" })
      .expect(500);
  });

  it("POST /verify/phone/send — 400 without phone", async () => {
    await request(app).post("/verify/phone/send").send({}).expect(400);
  });

  it("POST /verify/phone/send — 503 SMS not configured", async () => {
    verificationLib.sendSmsVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "SMS service not configured",
    });
    await request(app).post("/verify/phone/send").send({ phone: "+1" }).expect(503);
  });

  it("POST /verify/phone/send — 503 catch message shape", async () => {
    verificationLib.sendSmsVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "SMS service down",
    });
    await request(app).post("/verify/phone/send").send({ phone: "+1" }).expect(503);
  });

  it("POST /verify/phone/send — 500 generic", async () => {
    verificationLib.sendSmsVerificationCode.mockResolvedValueOnce({
      success: false,
      message: "twilio exploded",
    });
    await request(app).post("/verify/phone/send").send({ phone: "+1" }).expect(500);
  });

  it("POST /verify/phone/send — 200", async () => {
    verificationLib.sendSmsVerificationCode.mockResolvedValueOnce({ success: true });
    await request(app).post("/verify/phone/send").send({ phone: "+15551234567" }).expect(200);
  });

  it("POST /verify/phone/send — 503 catch from thrown SMS service message", async () => {
    verificationLib.sendSmsVerificationCode.mockRejectedValueOnce(
      new Error("SMS service not configured"),
    );
    await request(app).post("/verify/phone/send").send({ phone: "+1" }).expect(503);
  });

  it("POST /verify/phone/send — 500 catch generic", async () => {
    verificationLib.sendSmsVerificationCode.mockRejectedValueOnce(new Error("db"));
    await request(app).post("/verify/phone/send").send({ phone: "+1" }).expect(500);
  });

  it("POST /verify/phone/verify — 400 missing fields", async () => {
    await request(app).post("/verify/phone/verify").send({ phone: "+1" }).expect(400);
  });

  it("POST /verify/phone/verify — 400 invalid", async () => {
    verificationLib.verifyVerificationCode.mockResolvedValueOnce({ success: false, message: "nope" });
    await request(app)
      .post("/verify/phone/verify")
      .send({ phone: "+1", code: "1" })
      .expect(400);
  });

  it("POST /verify/phone/verify — 200", async () => {
    verificationLib.verifyVerificationCode.mockResolvedValueOnce({ success: true, userId: "u2" });
    const res = await request(app)
      .post("/verify/phone/verify")
      .send({ phone: "+1", code: "123456" })
      .expect(200);
    expect(res.body.userId).toBe("u2");
  });

  it("POST /verify/phone/verify — 500 on throw", async () => {
    verificationLib.verifyVerificationCode.mockRejectedValueOnce(new Error("db"));
    await request(app).post("/verify/phone/verify").send({ phone: "+1", code: "1" }).expect(500);
  });
});
