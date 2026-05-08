/**
 * Pure unit tests for `lib/passkey.ts` (Prisma mocked).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const randomBytesMock = vi.hoisted(() => vi.fn());

vi.mock("node:crypto", async (importOriginal) => {
  const m = await importOriginal<typeof import("node:crypto")>();
  return { ...m, randomBytes: randomBytesMock };
});

function prismaPasskeyMock() {
  return {
    passkeyChallenge: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    passkey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("lib/passkey", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generateChallenge returns base64url from 32 random bytes", async () => {
    randomBytesMock.mockReturnValue(Buffer.alloc(32, 7));
    const { generateChallenge } = await import("../src/lib/passkey.js");
    const ch = generateChallenge();
    expect(ch.length).toBeGreaterThan(10);
    expect(randomBytesMock).toHaveBeenCalledWith(32);
  });

  it("storeChallenge creates row with null userId mapped to undefined", async () => {
    randomBytesMock.mockReturnValue(Buffer.alloc(32, 1));
    const prisma = prismaPasskeyMock();
    (prisma.passkeyChallenge.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cid" });
    const { storeChallenge } = await import("../src/lib/passkey.js");
    const id = await storeChallenge(prisma, null, "ch", "registration");
    expect(id).toBe("cid");
    expect(prisma.passkeyChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: undefined,
          challenge: "ch",
          type: "registration",
        }),
      }),
    );
  });

  it("verifyChallenge returns null when no record", async () => {
    const prisma = prismaPasskeyMock();
    (prisma.passkeyChallenge.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { verifyChallenge } = await import("../src/lib/passkey.js");
    expect(await verifyChallenge(prisma, "x")).toBeNull();
  });

  it("verifyChallenge deletes and returns shape", async () => {
    const prisma = prismaPasskeyMock();
    (prisma.passkeyChallenge.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1",
      userId: "u1",
      type: "authentication",
    });
    const { verifyChallenge } = await import("../src/lib/passkey.js");
    const r = await verifyChallenge(prisma, "ch");
    expect(r).toEqual({ id: "r1", userId: "u1", type: "authentication" });
    expect(prisma.passkeyChallenge.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });

  it("verifyChallenge maps null userId to null in result", async () => {
    const prisma = prismaPasskeyMock();
    (prisma.passkeyChallenge.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "r1",
      userId: null,
      type: "registration",
    });
    const { verifyChallenge } = await import("../src/lib/passkey.js");
    const r = await verifyChallenge(prisma, "ch");
    expect(r?.userId).toBeNull();
  });

  it("registerPasskey uses defaults for device fields", async () => {
    const prisma = prismaPasskeyMock();
    const { registerPasskey } = await import("../src/lib/passkey.js");
    await registerPasskey(prisma, "u1", "cred", "pk");
    expect(prisma.passkey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        credentialId: "cred",
        publicKey: "pk",
        deviceName: "Unknown Device",
        deviceType: "platform",
        counter: 0,
      }),
    });
  });

  it("getUserPasskeys delegates to findMany", async () => {
    const prisma = prismaPasskeyMock();
    const rows = [{ id: "1", deviceName: "d", deviceType: "platform", lastUsedAt: null, createdAt: new Date() }];
    (prisma.passkey.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const { getUserPasskeys } = await import("../src/lib/passkey.js");
    expect(await getUserPasskeys(prisma, "u1")).toBe(rows);
  });

  it("getPasskeyByCredentialId returns null or row", async () => {
    const prisma = prismaPasskeyMock();
    (prisma.passkey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const { getPasskeyByCredentialId } = await import("../src/lib/passkey.js");
    expect(await getPasskeyByCredentialId(prisma, "c")).toBeNull();
    (prisma.passkey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "p1",
      userId: "u1",
      publicKey: "pk",
      counter: 3n,
    });
    expect(await getPasskeyByCredentialId(prisma, "c")).toMatchObject({
      id: "p1",
      counter: 3n,
    });
  });

  it("updatePasskeyUsage updates counter and lastUsedAt", async () => {
    const prisma = prismaPasskeyMock();
    const { updatePasskeyUsage } = await import("../src/lib/passkey.js");
    await updatePasskeyUsage(prisma, "cred", 9n);
    expect(prisma.passkey.update).toHaveBeenCalledWith({
      where: { credentialId: "cred" },
      data: expect.objectContaining({ counter: 9n }),
    });
  });

  it("deletePasskey returns boolean from count", async () => {
    const prisma = prismaPasskeyMock();
    (prisma.passkey.deleteMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const { deletePasskey } = await import("../src/lib/passkey.js");
    expect(await deletePasskey(prisma, "u1", "pk1")).toBe(false);
    expect(await deletePasskey(prisma, "u1", "pk1")).toBe(true);
  });
});
