/**
 * Pure unit tests for `lib/mfa.ts` (no HTTP). Mocks Prisma, otplib, bcrypt-queue, crypto, timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const randomBytesMock = vi.hoisted(() => vi.fn());
const genSecretMock = vi.hoisted(() => vi.fn(() => "TOTPSECRET12"));
const keyuriMock = vi.hoisted(() =>
  vi.fn(() => "otpauth://totp/Off-Campus-Housing-Tracker:test%40example.com?secret=TOTPSECRET12"),
);
const authenticatorVerifyMock = vi.hoisted(() => vi.fn());

vi.mock("node:crypto", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:crypto")>();
  return { ...mod, randomBytes: randomBytesMock };
});

vi.mock("otplib", () => ({
  authenticator: {
    generateSecret: genSecretMock,
    keyuri: keyuriMock,
    verify: (...args: unknown[]) => authenticatorVerifyMock(...args),
  },
  totp: {},
}));

const hashPasswordMock = vi.hoisted(() => vi.fn());
const comparePasswordMock = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/bcrypt-queue.js", () => ({
  hashPassword: (...a: unknown[]) => hashPasswordMock(...a),
  comparePassword: (...a: unknown[]) => comparePasswordMock(...a),
}));

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));

function prismaBase(): Pick<
  PrismaClient,
  "$queryRaw" | "$transaction" | "$executeRawUnsafe"
> {
  return {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  } as unknown as PrismaClient;
}

describe("lib/mfa", () => {
  beforeEach(() => {
    vi.useRealTimers();
    randomBytesMock.mockReset();
    randomBytesMock.mockImplementation((n: number) => Buffer.alloc(n, 0xab));
    genSecretMock.mockClear();
    keyuriMock.mockClear();
    authenticatorVerifyMock.mockReset();
    hashPasswordMock.mockReset();
    hashPasswordMock.mockImplementation((x: string) => Promise.resolve(`h:${x}`));
    comparePasswordMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("generateBackupCodes returns 10 uppercase hex strings", async () => {
    const { generateBackupCodes } = await import("../src/lib/mfa.js");
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[0-9A-F]{8}$/);
  });

  it("hashBackupCodes hashes each code", async () => {
    const { hashBackupCodes } = await import("../src/lib/mfa.js");
    const out = await hashBackupCodes(["a", "b"]);
    expect(out).toEqual(["h:a", "h:b"]);
  });

  it("verifyBackupCode returns true on first match", async () => {
    const { verifyBackupCode } = await import("../src/lib/mfa.js");
    comparePasswordMock.mockImplementation((plain: string, hashed: string) =>
      Promise.resolve(plain === "ok" && hashed === "h1"),
    );
    const ok = await verifyBackupCode(["h0", "h1"], "ok");
    expect(ok).toBe(true);
    expect(comparePasswordMock).toHaveBeenCalled();
  });

  it("verifyBackupCode returns false when no hash matches", async () => {
    const { verifyBackupCode } = await import("../src/lib/mfa.js");
    comparePasswordMock.mockResolvedValue(false);
    const ok = await verifyBackupCode(["h0"], "x");
    expect(ok).toBe(false);
  });

  it("setupMFA inserts settings and returns secret + backup codes", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { setupMFA } = await import("../src/lib/mfa.js");
    const r = await setupMFA(prisma as PrismaClient, "u1", "u@e.com");
    expect(r.secret).toBe("TOTPSECRET12");
    expect(r.backupCodes).toHaveLength(10);
    expect(r.qrCode).toBe("");
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(genSecretMock).toHaveBeenCalled();
  });

  it("verifyMFA returns false when no settings row", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const { verifyMFA } = await import("../src/lib/mfa.js");
    expect(await verifyMFA(prisma as PrismaClient, "u1", "123456")).toBe(false);
  });

  it("verifyMFA returns false when MFA disabled and allowUnenabled false", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { totp_secret: "sec", backup_codes: [], enabled: false },
    ]);
    const { verifyMFA } = await import("../src/lib/mfa.js");
    expect(await verifyMFA(prisma as PrismaClient, "u1", "123456", false)).toBe(false);
  });

  it("verifyMFA accepts TOTP when enabled and authenticator.verify true", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { totp_secret: "sec", backup_codes: ["hb"], enabled: true },
    ]);
    authenticatorVerifyMock.mockReturnValue(true);
    const { verifyMFA } = await import("../src/lib/mfa.js");
    expect(await verifyMFA(prisma as PrismaClient, "u1", "111111")).toBe(true);
    expect(authenticatorVerifyMock).toHaveBeenCalled();
  });

  it("verifyMFA accepts TOTP when disabled but allowUnenabled true", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { totp_secret: "sec", backup_codes: [], enabled: false },
    ]);
    authenticatorVerifyMock.mockReturnValue(true);
    const { verifyMFA } = await import("../src/lib/mfa.js");
    expect(await verifyMFA(prisma as PrismaClient, "u1", "111111", true)).toBe(true);
  });

  it("verifyMFA falls back to backup code and updates remaining codes", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { totp_secret: "sec", backup_codes: ["h1", "h2"], enabled: true },
      ])
      .mockResolvedValueOnce(undefined);
    authenticatorVerifyMock.mockReturnValue(false);
    comparePasswordMock.mockImplementation((plain: string, hashed: string) =>
      Promise.resolve(plain === "BACKUP" && hashed === "h1"),
    );
    const { verifyMFA } = await import("../src/lib/mfa.js");
    expect(await verifyMFA(prisma as PrismaClient, "u1", "BACKUP")).toBe(true);
    const updateCall = (prisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(updateCall).toBeDefined();
  });

  it("verifyMFA catches authenticator.verify throw and tries backup", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { totp_secret: "sec", backup_codes: ["h1"], enabled: true },
    ]);
    authenticatorVerifyMock.mockImplementation(() => {
      throw new Error("bad token format");
    });
    comparePasswordMock.mockResolvedValue(false);
    const { verifyMFA } = await import("../src/lib/mfa.js");
    expect(await verifyMFA(prisma as PrismaClient, "u1", "x")).toBe(false);
  });

  it("enableMFA throws when MFA settings row missing", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const { enableMFA } = await import("../src/lib/mfa.js");
    await expect(enableMFA(prisma as PrismaClient, "u1")).rejects.toThrow(
      "MFA settings not found",
    );
  });

  it("enableMFA completes when transaction and post-commit verify succeed", async () => {
    vi.useFakeTimers();
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: "m1" }])
      .mockResolvedValueOnce([{ pid: 1 }])
      .mockResolvedValueOnce([
        { mfa_enabled: true, mfa_settings_enabled: true },
      ]);
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { mfa_enabled: true, mfa_settings_enabled: true },
      ]),
    };
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx);
    });
    const { enableMFA } = await import("../src/lib/mfa.js");
    const p = enableMFA(prisma as PrismaClient, "u1");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBeUndefined();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("enableMFA throws when settings update affects 0 rows", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: "m1" }]);
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValueOnce(0),
      $queryRaw: vi.fn(),
    };
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx);
    });
    const { enableMFA } = await import("../src/lib/mfa.js");
    await expect(enableMFA(prisma as PrismaClient, "u1")).rejects.toThrow(
      "Failed to update mfa_settings",
    );
  });

  it("enableMFA throws when users update affects 0 rows", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: "m1" }]);
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      $queryRaw: vi.fn(),
    };
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx);
    });
    const { enableMFA } = await import("../src/lib/mfa.js");
    await expect(enableMFA(prisma as PrismaClient, "u1")).rejects.toThrow(
      "User u1 not found when enabling MFA",
    );
  });

  it("enableMFA throws when in-tx verification row is inconsistent", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: "m1" }]);
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { mfa_enabled: false, mfa_settings_enabled: true },
      ]),
    };
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx);
    });
    const { enableMFA } = await import("../src/lib/mfa.js");
    await expect(enableMFA(prisma as PrismaClient, "u1")).rejects.toThrow(
      "Transaction verification failed",
    );
  });

  it("enableMFA returns after retries when post-commit verify never succeeds", async () => {
    vi.useFakeTimers();
    const prisma = prismaBase();
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { mfa_enabled: true, mfa_settings_enabled: true },
      ]),
    };
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx);
    });
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: "m1" }])
      .mockResolvedValueOnce([{ pid: 1 }])
      .mockResolvedValue([
        { mfa_enabled: false, mfa_settings_enabled: false },
      ]);
    const { enableMFA } = await import("../src/lib/mfa.js");
    const p = enableMFA(prisma as PrismaClient, "u1");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  it("disableMFA runs both updates", async () => {
    const prisma = prismaBase();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { disableMFA } = await import("../src/lib/mfa.js");
    await disableMFA(prisma as PrismaClient, "u1");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
