import { expect, test } from "@playwright/test";
import {
  apiGatewayReady,
  e2eApiBase,
  uniqueE2eEmail,
} from "./helpers";

function userIdFromJwt(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid token payload");
  const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
    sub?: string;
    user_id?: string;
  };
  const id = json.user_id || json.sub;
  if (!id) throw new Error("missing user id in token");
  return id;
}

async function registerToken(
  request: import("@playwright/test").APIRequestContext,
  prefix: string,
  ix: number,
) {
  const email = uniqueE2eEmail(prefix, ix);
  const password = "Password123!";
  const reg = await request.post(`${e2eApiBase()}/api/auth/register`, {
    data: { email, password },
  });
  const regJson = (await reg.json().catch(() => ({}))) as { token?: string };
  if (regJson.token) return { token: regJson.token, email };
  const login = await request.post(`${e2eApiBase()}/api/auth/login`, {
    data: { email, password },
  });
  const loginJson = (await login.json().catch(() => ({}))) as { token?: string };
  if (!loginJson.token) throw new Error("unable to acquire auth token");
  return { token: loginJson.token, email };
}

test.describe("contract: community + listings pagination + booking transitions", () => {
  test.beforeEach(async ({ request }) => {
    if (!(await apiGatewayReady(request))) {
      test.skip();
    }
  });

  test("GET /api/community/posts rejects invalid pageSize when page is set", async ({ request }) => {
    const base = e2eApiBase();
    const r = await request.get(`${base}/api/community/posts?page=1&pageSize=25`);
    expect(r.status()).toBe(400);
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    expect(j.error).toBe("invalid_page_size");
  });

  test("GET /api/listings/search returns totalCount for page mode", async ({ request }) => {
    const base = e2eApiBase();
    const r = await request.get(`${base}/api/listings/search?page=1&pageSize=24`);
    expect(r.ok()).toBeTruthy();
    const j = (await r.json()) as { totalCount?: number };
    expect(typeof j.totalCount).toBe("number");
  });

  test("GET /api/community/posts returns envelope (skipped if schema missing)", async ({ request }) => {
    const base = e2eApiBase();
    const r = await request.get(`${base}/api/community/posts?page=1&pageSize=24`);
    if (r.status() === 500) {
      test.skip(true, "Apply infra/db/07-community-posts.sql to listings DB");
    }
    expect(r.ok()).toBeTruthy();
    const j = (await r.json()) as {
      posts?: unknown[];
      totalCount?: number;
      page?: number;
      totalPages?: number;
    };
    expect(Array.isArray(j.posts)).toBe(true);
    expect(typeof j.totalCount).toBe("number");
  });

  test("booking: landlord accepts then tenant confirms", async ({ request }, testInfo) => {
    const ix = testInfo.parallelIndex;
    const landlord = await registerToken(request, "och-contract-ll", ix);
    const tenant = await registerToken(request, "och-contract-rt", ix);
    const landlordId = userIdFromJwt(landlord.token);
    const tenantId = userIdFromJwt(tenant.token);

    const day = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    const listingRes = await request.post(`${e2eApiBase()}/api/listings/create`, {
      headers: { Authorization: `Bearer ${landlord.token}` },
      data: {
        title: `contract listing ${ix}`,
        description: "2 bed near campus for booking contract flow",
        price_cents: 150000,
        effective_from: day,
        amenities: ["wifi"],
        smoke_free: true,
        pet_friendly: false,
      },
    });
    expect(listingRes.ok(), await listingRes.text()).toBeTruthy();
    const listingJson = (await listingRes.json()) as { id?: string };
    const listingId = listingJson.id;
    expect(listingId).toBeTruthy();

    const reqBooking = await request.post(`${e2eApiBase()}/api/booking/request`, {
      headers: { Authorization: `Bearer ${tenant.token}` },
      data: {
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: day,
        message: "contract flow",
      },
    });
    expect(reqBooking.ok(), await reqBooking.text()).toBeTruthy();
    const bookingBody = (await reqBooking.json()) as { booking_id?: string };
    const bookingId = bookingBody.booking_id;
    expect(bookingId).toBeTruthy();

    const accept = await request.post(`${e2eApiBase()}/api/booking/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${landlord.token}`, "x-user-id": landlordId },
      data: { to: "ACCEPTED" },
    });
    expect(accept.ok(), await accept.text()).toBeTruthy();

    const confirm = await request.post(`${e2eApiBase()}/api/booking/bookings/${bookingId}/status`, {
      headers: { Authorization: `Bearer ${tenant.token}`, "x-user-id": tenantId },
      data: { to: "CONFIRMED" },
    });
    expect(confirm.ok(), await confirm.text()).toBeTruthy();
    const out = (await confirm.json()) as { status?: string };
    expect(out.status).toBe("CONFIRMED");
  });
});
