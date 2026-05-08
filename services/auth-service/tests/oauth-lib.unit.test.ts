/**
 * Pure unit tests for `lib/oauth.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const signJwtMock = vi.hoisted(() => vi.fn(() => "signed-jwt"));
const randomUUIDMock = vi.hoisted(() => vi.fn(() => "00000000-0000-4000-8000-000000000001"));

vi.mock("@common/utils/auth", () => ({
  signJwt: (...args: unknown[]) => signJwtMock(...args),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const m = await importOriginal<typeof import("node:crypto")>();
  return { ...m, randomUUID: randomUUIDMock };
});

function prismaMock(): Pick<PrismaClient, "$queryRaw"> {
  return { $queryRaw: vi.fn() } as unknown as PrismaClient;
}

describe("lib/oauth", () => {
  beforeEach(() => {
    vi.resetModules();
    signJwtMock.mockClear();
    randomUUIDMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("findOrCreateOAuthUser returns existing OAuth link", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { user_id: "u1", email: "e@e.com" },
    ]);
    const { findOrCreateOAuthUser } = await import("../src/lib/oauth.js");
    const r = await findOrCreateOAuthUser(prisma as PrismaClient, "google", {
      id: "p1",
      email: "e@e.com",
    });
    expect(r).toEqual({ userId: "u1", email: "e@e.com", isNewUser: false });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("findOrCreateOAuthUser links to existing user by email", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "existing", email: "e@e.com" }])
      .mockResolvedValueOnce(undefined);
    const { findOrCreateOAuthUser } = await import("../src/lib/oauth.js");
    const r = await findOrCreateOAuthUser(prisma as PrismaClient, "google", {
      id: "p-new",
      email: "e@e.com",
    });
    expect(r.isNewUser).toBe(false);
    expect(r.userId).toBe("existing");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("findOrCreateOAuthUser creates new user and provider row", async () => {
    const prisma = prismaMock();
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "new-u", email: "new@e.com" }])
      .mockResolvedValueOnce(undefined);
    const { findOrCreateOAuthUser } = await import("../src/lib/oauth.js");
    const r = await findOrCreateOAuthUser(prisma as PrismaClient, "google", {
      id: "p-new",
      email: "new@e.com",
      name: "N",
    });
    expect(r.isNewUser).toBe(true);
    expect(r.userId).toBe("new-u");
    expect(r.email).toBe("new@e.com");
  });

  it("generateOAuthToken passes jti and user fields to signJwt", async () => {
    const { generateOAuthToken } = await import("../src/lib/oauth.js");
    const t = generateOAuthToken("u1", "e@e.com");
    expect(t).toBe("signed-jwt");
    expect(randomUUIDMock).toHaveBeenCalled();
    expect(signJwtMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "u1",
        email: "e@e.com",
        jti: "00000000-0000-4000-8000-000000000001",
      }),
    );
  });
});
