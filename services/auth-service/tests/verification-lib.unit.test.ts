/**
 * Pure unit tests for `lib/verification.ts` (no HTTP).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const randomIntMock = vi.hoisted(() => vi.fn());
const createSmsProviderMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn());
const sendMailMock = vi.hoisted(() => vi.fn());

vi.mock("node:crypto", async (importOriginal) => {
  const m = await importOriginal<typeof import("node:crypto")>();
  return { ...m, randomInt: randomIntMock };
});

vi.mock("../src/lib/sms-providers.js", () => ({
  createSmsProvider: (...args: unknown[]) => createSmsProviderMock(...args),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransportMock(...args),
  },
}));

const hashPasswordMock = vi.hoisted(() => vi.fn());
const comparePasswordMock = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/bcrypt-queue.js", () => ({
  hashPassword: (...a: unknown[]) => hashPasswordMock(...a),
  comparePassword: (...a: unknown[]) => comparePasswordMock(...a),
}));

function prismaMock(): Pick<PrismaClient, "$queryRaw"> {
  return { $queryRaw: vi.fn() } as unknown as PrismaClient;
}

describe("lib/verification", () => {
  const origSmtpHost = process.env.SMTP_HOST;
  const origSmtpPort = process.env.SMTP_PORT;
  const origSmtpUser = process.env.SMTP_USER;
  const origSmtpPass = process.env.SMTP_PASSWORD;
  const origSmtpFrom = process.env.SMTP_FROM;
  const origNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    randomIntMock.mockReturnValue(444_444 as never);
    hashPasswordMock.mockImplementation((c: string) => Promise.resolve(`hash:${c}`));
    comparePasswordMock.mockReset();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    createSmsProviderMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = origNodeEnv ?? "test";
    if (origSmtpHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = origSmtpHost;
    if (origSmtpPort === undefined) delete process.env.SMTP_PORT;
    else process.env.SMTP_PORT = origSmtpPort;
    if (origSmtpUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = origSmtpUser;
    if (origSmtpPass === undefined) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = origSmtpPass;
    if (origSmtpFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = origSmtpFrom;
  });

  it("getEmailTransporter path: no SMTP_HOST returns failure from sendEmailVerificationCode", async () => {
    delete process.env.SMTP_HOST;
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendEmailVerificationCode } = await import("../src/lib/verification.js");
    const r = await sendEmailVerificationCode(prisma as PrismaClient, "uid", "a@b.com");
    expect(r.success).toBe(false);
    expect(r.message).toContain("not configured");
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("sendEmailVerificationCode uses MailHog-style SMTP without auth branch", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendEmailVerificationCode } = await import("../src/lib/verification.js");
    const r = await sendEmailVerificationCode(prisma as PrismaClient, null, "a@b.com");
    expect(r.success).toBe(true);
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "127.0.0.1", port: 1025, secure: false }),
    );
    expect(sendMailMock).toHaveBeenCalled();
  });

  it("sendEmailVerificationCode uses secure true when port 465", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendEmailVerificationCode } = await import("../src/lib/verification.js");
    await sendEmailVerificationCode(prisma as PrismaClient, "uid-1", "x@y.com");
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        auth: { user: "u", pass: "p" },
      }),
    );
  });

  it("sendEmailVerificationCode maps sendMail rejection to message", async () => {
    process.env.SMTP_HOST = "h";
    process.env.SMTP_PORT = "587";
    sendMailMock.mockRejectedValueOnce(new Error("smtp-down"));
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendEmailVerificationCode } = await import("../src/lib/verification.js");
    const r = await sendEmailVerificationCode(prisma as PrismaClient, "u1", "e@e.com");
    expect(r.success).toBe(false);
    expect(r.message).toBe("smtp-down");
  });

  it("sendSmsVerificationCode fails when no SMS provider", async () => {
    process.env.NODE_ENV = "test";
    createSmsProviderMock.mockReturnValue(null);
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendSmsVerificationCode } = await import("../src/lib/verification.js");
    const r = await sendSmsVerificationCode(prisma as PrismaClient, "u1", "+15550001111");
    expect(r.success).toBe(false);
    expect(r.message).toContain("not configured");
  });

  it("sendSmsVerificationCode fails when provider returns success false without error string", async () => {
    createSmsProviderMock.mockReturnValue({
      getName: () => "Mock",
      sendSms: vi.fn().mockResolvedValue({ success: false }),
    });
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendSmsVerificationCode } = await import("../src/lib/verification.js");
    const r = await sendSmsVerificationCode(prisma as PrismaClient, "u1", "+1");
    expect(r.success).toBe(false);
    expect(r.message).toBe("Failed to send SMS");
  });

  it("sendSmsVerificationCode fails when provider returns success false", async () => {
    createSmsProviderMock.mockReturnValue({
      getName: () => "Mock",
      sendSms: vi.fn().mockResolvedValue({ success: false, error: "rate" }),
    });
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendSmsVerificationCode } = await import("../src/lib/verification.js");
    const r = await sendSmsVerificationCode(prisma as PrismaClient, null, "+1");
    expect(r.success).toBe(false);
    expect(r.message).toBe("rate");
  });

  it("sendSmsVerificationCode succeeds with userId and null userId insert branches", async () => {
    createSmsProviderMock.mockReturnValue({
      getName: () => "Mock",
      sendSms: vi.fn().mockResolvedValue({ success: true, messageId: "mid" }),
    });
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { sendSmsVerificationCode } = await import("../src/lib/verification.js");
    expect(
      (await sendSmsVerificationCode(prisma as PrismaClient, "uuid-here", "+1555")).success,
    ).toBe(true);
    vi.resetModules();
    createSmsProviderMock.mockReturnValue({
      getName: () => "Mock",
      sendSms: vi.fn().mockResolvedValue({ success: true, messageId: "mid" }),
    });
    const prisma2 = prismaMock();
    (prisma2.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const mod2 = await import("../src/lib/verification.js");
    expect((await mod2.sendSmsVerificationCode(prisma2 as PrismaClient, null, "+1556")).success).toBe(
      true,
    );
  });

  it("verifyVerificationCode invalid when no row", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const { verifyVerificationCode } = await import("../src/lib/verification.js");
    const r = await verifyVerificationCode(prisma as PrismaClient, "email", "t@t.com", "111111");
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Invalid|expired/i);
  });

  it("verifyVerificationCode invalid when hash mismatch", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "vc1",
        user_id: "u1",
        code: "hash:444444",
        expires_at: new Date(),
        used: false,
      },
    ]);
    comparePasswordMock.mockResolvedValue(false);
    const { verifyVerificationCode } = await import("../src/lib/verification.js");
    const r = await verifyVerificationCode(prisma as PrismaClient, "email", "t@t.com", "000000");
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Invalid code/i);
  });

  it("verifyVerificationCode email path updates user when user_id set", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: "vc1",
          user_id: "u1",
          code: "hash:444444",
          expires_at: new Date(),
          used: false,
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    comparePasswordMock.mockResolvedValue(true);
    const { verifyVerificationCode } = await import("../src/lib/verification.js");
    const r = await verifyVerificationCode(prisma as PrismaClient, "email", "t@t.com", "444444");
    expect(r.success).toBe(true);
    expect(r.userId).toBe("u1");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("verifyVerificationCode phone path updates phone_verified", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: "vc1",
          user_id: "u1",
          code: "hash:444444",
          expires_at: new Date(),
          used: false,
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    comparePasswordMock.mockResolvedValue(true);
    const { verifyVerificationCode } = await import("../src/lib/verification.js");
    const r = await verifyVerificationCode(prisma as PrismaClient, "phone", "+1", "444444");
    expect(r.success).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("verifyVerificationCode skips user update when user_id null", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: "vc1",
          user_id: null,
          code: "hash:444444",
          expires_at: new Date(),
          used: false,
        },
      ])
      .mockResolvedValueOnce(undefined);
    comparePasswordMock.mockResolvedValue(true);
    const { verifyVerificationCode } = await import("../src/lib/verification.js");
    const r = await verifyVerificationCode(prisma as PrismaClient, "email", "t@t.com", "444444");
    expect(r.success).toBe(true);
    expect(r.userId).toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
