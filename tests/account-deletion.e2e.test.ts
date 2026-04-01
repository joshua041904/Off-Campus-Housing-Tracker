/**
 * Account deletion E2E.
 *
 * Auth HTTP checks:
 *   ACCOUNT_DELETION_E2E=1 pnpm run test:account-deletion-e2e
 *   Optional: ACCOUNT_DELETION_AUTH_BASE_URL=http://127.0.0.1:4001
 *
 * Full cross-service (helpers still TODO until wired):
 *   ACCOUNT_DELETION_E2E=1 ACCOUNT_DELETION_E2E_FULL=1 pnpm run test:account-deletion-e2e
 */
import { describe, it, expect, beforeAll } from "vitest";
import { waitForKafkaPropagation } from "./helpers/wait-for-kafka-propagation";

const enabled = process.env.ACCOUNT_DELETION_E2E === "1";
const fullStack = process.env.ACCOUNT_DELETION_E2E_FULL === "1";

const authBase = (
  process.env.ACCOUNT_DELETION_AUTH_BASE_URL || "http://127.0.0.1:4001"
).replace(/\/$/, "");

async function registerUser(): Promise<{ userId: string; token: string; email: string }> {
  const email = `del_e2e_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`;
  const password = "TestPassword1!E2e";
  const res = await fetch(`${authBase}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, sendVerification: false }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`register failed ${res.status}: ${t}`);
  }
  const j = (await res.json()) as { token?: string };
  if (!j.token) throw new Error("register: no token");
  const payload = JSON.parse(
    Buffer.from(j.token.split(".")[1] || "", "base64url").toString("utf8"),
  ) as { sub?: string };
  if (!payload.sub) throw new Error("register: no sub in jwt");
  return { userId: payload.sub, token: j.token, email };
}

async function fetchDeleteAccount(token: string): Promise<Response> {
  return fetch(`${authBase}/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function fetchMe(token: string): Promise<{ is_deleted?: boolean; sub?: string }> {
  const res = await fetch(`${authBase}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GET /me failed ${res.status}: ${t}`);
  }
  return (await res.json()) as { is_deleted?: boolean; sub?: string };
}

async function createListing(_userId: string): Promise<string> {
  throw new Error("TODO: createListing — set LISTINGS + gateway env and implement");
}

async function createBooking(_userId: string, _listingId: string): Promise<void> {
  throw new Error("TODO: createBooking");
}

async function sendMessage(_userId: string): Promise<void> {
  throw new Error("TODO: sendMessage");
}

async function flagListing(_userId: string, _listingId: string): Promise<void> {
  throw new Error("TODO: flagListing");
}

async function getMessages(userId: string): Promise<{ senderDisplay?: string }> {
  void userId;
  throw new Error("TODO: getMessages");
}

async function getTrustData(userId: string): Promise<{ reputationScore?: number }> {
  void userId;
  throw new Error("TODO: getTrustData");
}

async function getListing(listingId: string): Promise<{ status?: string }> {
  void listingId;
  throw new Error("TODO: getListing");
}

describe.skipIf(!enabled || fullStack)("Account deletion — auth HTTP", () => {
  let token: string;

  beforeAll(async () => {
    const r = await registerUser();
    token = r.token;
  });

  it("DELETE /account returns 202, anonymizes user, second delete returns already_deleted", async () => {
    const del1 = await fetchDeleteAccount(token);
    expect(del1.status).toBe(202);
    const me1 = await fetchMe(token);
    expect(me1.is_deleted).toBe(true);

    const del2 = await fetchDeleteAccount(token);
    expect(del2.status).toBe(202);
    const body2 = (await del2.json()) as { status?: string };
    expect(body2.status).toBe("already_deleted");

    const me2 = await fetchMe(token);
    expect(me2.is_deleted).toBe(true);
  });
});

describe.skipIf(!enabled || !fullStack)("Account deletion — full stack (scaffold)", () => {
  let userId: string;
  let token: string;
  let listingId: string;

  beforeAll(async () => {
    const r = await registerUser();
    userId = r.userId;
    token = r.token;
    listingId = await createListing(userId);
    await createBooking(userId, listingId);
    await sendMessage(userId);
    await flagListing(userId, listingId);
  }, 120_000);

  it("delete account propagates to all services", async () => {
    await fetchDeleteAccount(token);

    await waitForKafkaPropagation(8000, 300, async () => {
      const u = await fetchMe(token);
      return u.is_deleted === true;
    });

    const user = await fetchMe(token);
    expect(user.is_deleted).toBe(true);

    const conversation = await getMessages(userId);
    expect(conversation.senderDisplay).toMatch(/deleted|Deleted/i);

    const trustData = await getTrustData(userId);
    expect(trustData.reputationScore).toBeDefined();

    const listing = await getListing(listingId);
    expect(["inactive", "archived", "disabled", "closed", "paused"]).toContain(listing.status);
  });
});

describe("Account deletion — unit helpers", () => {
  it("waitForKafkaPropagation resolves with default ready fn", async () => {
    await waitForKafkaPropagation(1000, 50);
  });

  it("waitForKafkaPropagation throws on timeout when never ready", async () => {
    await expect(
      waitForKafkaPropagation(80, 20, async () => false),
    ).rejects.toThrow(/timeout/);
  });
});
