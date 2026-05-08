/**
 * HTTP branch coverage for `routes/passkey.ts` (mocked Prisma + passkey lib).
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "@common/utils/auth";
import passkeyRouter from "../src/routes/passkey.js";
import { prisma } from "../src/lib/prisma.js";
import * as passkeyLib from "../src/lib/passkey.js";

const userId = randomUUID();

function authHeader(): { Authorization: string } {
  const token = signJwt({ sub: userId, email: "user@example.com" });
  return { Authorization: `Bearer ${token}` };
}

describe("passkey routes", () => {
  const app = express();
  app.use(express.json());
  app.use("/passkeys", passkeyRouter);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([] as never);
    vi.spyOn(passkeyLib, "generateChallenge").mockReturnValue("ch-fixed");
    vi.spyOn(passkeyLib, "storeChallenge").mockResolvedValue("ok");
    vi.spyOn(passkeyLib, "verifyChallenge").mockReset();
    vi.spyOn(passkeyLib, "registerPasskey").mockReset().mockResolvedValue(undefined);
    vi.spyOn(passkeyLib, "getUserPasskeys").mockReset();
    vi.spyOn(passkeyLib, "getPasskeyByCredentialId").mockReset();
    vi.spyOn(passkeyLib, "updatePasskeyUsage").mockReset().mockResolvedValue(undefined);
    vi.spyOn(passkeyLib, "deletePasskey").mockReset();
  });

  it("POST /passkeys/register/start — 401 without token", async () => {
    await request(app).post("/passkeys/register/start").expect(401);
  });

  it("POST /passkeys/register/start — 200", async () => {
    const res = await request(app)
      .post("/passkeys/register/start")
      .set(authHeader())
      .expect(200);
    expect(res.body.challenge).toBe("ch-fixed");
    expect(res.body.userId).toBe(userId);
    expect(passkeyLib.storeChallenge).toHaveBeenCalled();
  });

  it("POST /passkeys/register/finish — 400 missing fields", async () => {
    await request(app)
      .post("/passkeys/register/finish")
      .set(authHeader())
      .send({})
      .expect(400);
  });

  it("POST /passkeys/register/finish — mock path success in test env", async () => {
    passkeyLib.verifyChallenge.mockResolvedValue({
      id: "c1",
      userId,
      type: "registration",
    });
    const res = await request(app)
      .post("/passkeys/register/finish")
      .set(authHeader())
      .send({
        challenge: "x",
        credentialId: "cred-1",
        publicKey: "pk-b64",
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(passkeyLib.registerPasskey).toHaveBeenCalled();
  });

  it("POST /passkeys/register/finish — 400 invalid challenge", async () => {
    passkeyLib.verifyChallenge.mockResolvedValue(null);
    await request(app)
      .post("/passkeys/register/finish")
      .set(authHeader())
      .send({
        challenge: "bad",
        credentialId: "c",
        publicKey: "p",
      })
      .expect(400);
  });

  it("POST /passkeys/authenticate/start — 400 no email", async () => {
    await request(app).post("/passkeys/authenticate/start").send({}).expect(400);
  });

  it("POST /passkeys/authenticate/start — 404 unknown user", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);
    await request(app)
      .post("/passkeys/authenticate/start")
      .send({ email: "missing@example.com" })
      .expect(404);
  });

  it("POST /passkeys/authenticate/start — 400 no passkeys", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: userId }] as never);
    passkeyLib.getUserPasskeys.mockResolvedValueOnce([]);
    await request(app)
      .post("/passkeys/authenticate/start")
      .send({ email: "u@example.com" })
      .expect(400);
  });

  it("POST /passkeys/authenticate/start — 200", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: userId }] as never);
    passkeyLib.getUserPasskeys.mockResolvedValueOnce([
      { id: "pk1", deviceName: "d", deviceType: "platform", lastUsedAt: null, createdAt: new Date() },
    ]);
    const res = await request(app)
      .post("/passkeys/authenticate/start")
      .send({ email: "ok@example.com" })
      .expect(200);
    expect(res.body.challenge).toBe("ch-fixed");
  });

  it("POST /passkeys/authenticate/finish — 400 missing fields", async () => {
    await request(app).post("/passkeys/authenticate/finish").send({}).expect(400);
  });

  it("POST /passkeys/authenticate/finish — 400 bad challenge", async () => {
    passkeyLib.verifyChallenge.mockResolvedValueOnce(null);
    await request(app)
      .post("/passkeys/authenticate/finish")
      .send({ challenge: "c", credentialId: "id" })
      .expect(400);
  });

  it("POST /passkeys/authenticate/finish — 401 wrong passkey", async () => {
    passkeyLib.verifyChallenge.mockResolvedValueOnce({
      id: "x",
      userId,
      type: "authentication",
    });
    passkeyLib.getPasskeyByCredentialId.mockResolvedValueOnce(null);
    await request(app)
      .post("/passkeys/authenticate/finish")
      .send({ challenge: "c", credentialId: "bad" })
      .expect(401);
  });

  it("POST /passkeys/authenticate/finish — 401 replay counter", async () => {
    passkeyLib.verifyChallenge.mockResolvedValueOnce({
      id: "x",
      userId,
      type: "authentication",
    });
    passkeyLib.getPasskeyByCredentialId.mockResolvedValueOnce({
      id: "pk",
      userId,
      publicKey: "k",
      counter: 5n,
    });
    await request(app)
      .post("/passkeys/authenticate/finish")
      .send({ challenge: "c", credentialId: "cred", counter: 3 })
      .expect(401);
  });

  it("POST /passkeys/authenticate/finish — 200", async () => {
    passkeyLib.verifyChallenge.mockResolvedValueOnce({
      id: "x",
      userId,
      type: "authentication",
    });
    passkeyLib.getPasskeyByCredentialId.mockResolvedValueOnce({
      id: "pk",
      userId,
      publicKey: "k",
      counter: 1n,
    });
    const res = await request(app)
      .post("/passkeys/authenticate/finish")
      .send({ challenge: "c", credentialId: "cred", counter: 9 })
      .expect(200);
    expect(res.body.token).toBeTruthy();
    expect(passkeyLib.updatePasskeyUsage).toHaveBeenCalled();
  });

  it("GET /passkeys — 401 and 200", async () => {
    await request(app).get("/passkeys").expect(401);
    passkeyLib.getUserPasskeys.mockResolvedValueOnce([]);
    const res = await request(app).get("/passkeys").set(authHeader()).expect(200);
    expect(res.body.passkeys).toEqual([]);
  });

  it("POST /passkeys/register/start — 500 when storeChallenge fails", async () => {
    passkeyLib.storeChallenge.mockRejectedValueOnce(new Error("db"));
    await request(app)
      .post("/passkeys/register/start")
      .set(authHeader())
      .expect(500);
  });

  it("POST /passkeys/register/finish — 500 when registerPasskey fails", async () => {
    passkeyLib.verifyChallenge.mockResolvedValueOnce({
      id: "c1",
      userId,
      type: "registration",
    });
    passkeyLib.registerPasskey.mockRejectedValueOnce(new Error("db"));
    await request(app)
      .post("/passkeys/register/finish")
      .set(authHeader())
      .send({
        challenge: "x",
        credentialId: "cred-1",
        publicKey: "pk-b64",
      })
      .expect(500);
  });

  it("POST /passkeys/authenticate/start — 500 on prisma error", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("db"));
    await request(app)
      .post("/passkeys/authenticate/start")
      .send({ email: "x@y.com" })
      .expect(500);
  });

  it("DELETE /passkeys/:id — 500 on error", async () => {
    passkeyLib.deletePasskey.mockRejectedValueOnce(new Error("db"));
    await request(app)
      .delete(`/passkeys/${randomUUID()}`)
      .set(authHeader())
      .expect(500);
  });

  it("DELETE /passkeys/:id — 404 and 200", async () => {
    passkeyLib.deletePasskey.mockResolvedValueOnce(false);
    await request(app)
      .delete(`/passkeys/${randomUUID()}`)
      .set(authHeader())
      .expect(404);
    passkeyLib.deletePasskey.mockResolvedValueOnce(true);
    await request(app)
      .delete(`/passkeys/${randomUUID()}`)
      .set(authHeader())
      .expect(200);
  });
});
