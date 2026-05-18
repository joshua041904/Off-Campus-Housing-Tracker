import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, registerViaUi, uniqueE2eEmail } from "./helpers";

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

async function registerToken(request: APIRequestContext, prefix: string, workerIndex: number): Promise<string> {
  const email = uniqueE2eEmail(prefix, workerIndex);
  const password = "Password123!";
  const reg = await request.post(`${e2eApiBase()}/api/auth/register`, {
    data: { email, password },
  });
  const regJson = (await reg.json().catch(() => ({}))) as { token?: string };
  if (regJson.token) return regJson.token;
  const login = await request.post(`${e2eApiBase()}/api/auth/login`, {
    data: { email, password },
  });
  const loginJson = (await login.json().catch(() => ({}))) as { token?: string };
  if (!loginJson.token) throw new Error("unable to acquire auth token");
  return loginJson.token;
}

async function createListing(request: APIRequestContext, token: string, stamp: number): Promise<string> {
  const resp = await request.post(`${e2eApiBase()}/api/listings/create`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `Moderation E2E ${stamp}`,
      description: "Trust moderation integration fixture.",
      price_cents: 145000,
      effective_from: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
      amenities: ["wifi"],
      smoke_free: true,
      pet_friendly: false,
      furnished: true,
    },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
  const json = (await resp.json().catch(() => ({}))) as { id?: string };
  expect(json.id).toBeTruthy();
  return json.id!;
}

async function seedManyListings(
  request: APIRequestContext,
  token: string,
  marker: string,
  targetCount: number,
): Promise<void> {
  let ok = 0;
  for (let i = 0; i < targetCount * 2 && ok < targetCount; i += 1) {
    const r = await request.post(`${e2eApiBase()}/api/listings/create`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: `${marker} batch-${i}`,
        description: `Batch listing ${i}`,
        price_cents: 90000 + (i % 50) * 1000,
        effective_from: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
        amenities: ["wifi", "parking"],
        smoke_free: true,
        pet_friendly: false,
        furnished: i % 2 === 0,
      },
    });
    if (r.ok()) ok += 1;
  }
}

test.describe.configure({ timeout: 180_000 });

test.describe("Trust · moderation · fraud · pagination (full)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayReady(request)), "gateway / DB stack not ready");
  });

  test("moderation: landlord accepts booking → tenant inbox receives booking.status.updated", async ({
    request,
  }, testInfo) => {
    const stamp = Date.now();
    const landlordTok = await registerToken(request, "och-mod-landlord", testInfo.workerIndex);
    const tenantTok = await registerToken(request, "och-mod-tenant", testInfo.workerIndex);
    const listingId = await createListing(request, landlordTok, stamp);
    const tenantId = userIdFromJwt(tenantTok);

    const day = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const br = await request.post(`${e2eApiBase()}/api/booking/request`, {
      headers: {
        Authorization: `Bearer ${tenantTok}`,
      },
      data: {
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: day,
        message: "moderation e2e",
      },
    });
    expect(br.ok(), await br.text()).toBeTruthy();
    const booking = (await br.json()) as { booking_id?: string };
    expect(booking.booking_id).toBeTruthy();

    const accept = await request.post(`${e2eApiBase()}/api/booking/${booking.booking_id}/accept`, {
      headers: { Authorization: `Bearer ${landlordTok}` },
    });
    expect(accept.ok(), await accept.text()).toBeTruthy();

    const dash = await request.get(`${e2eApiBase()}/api/dashboard/moderation`, {
      headers: { Authorization: `Bearer ${landlordTok}` },
    });
    expect(dash.ok(), await dash.text()).toBeTruthy();

    const notifs = await request.get(`${e2eApiBase()}/api/notification/notifications?limit=40`, {
      headers: { Authorization: `Bearer ${tenantTok}` },
    });
    expect(notifs.ok(), await notifs.text()).toBeTruthy();
    const inbox = (await notifs.json()) as { items?: { event_type?: string }[] };
    const hit = inbox.items?.some((it) => String(it.event_type || "").includes("booking.status.updated"));
    expect(hit).toBeTruthy();
  });

  test("listings pagination UI respects pageSize 96 then 24 and reorder changes rows", async ({
    page,
    request,
  }, testInfo) => {
    const marker = `och-page-${testInfo.workerIndex}-${Date.now()}`;
    const seedTok = await registerToken(request, "och-pagination-seed", testInfo.workerIndex);
    await seedManyListings(request, seedTok, marker, 120);

    const email = uniqueE2eEmail("och-page-ui", testInfo.workerIndex);
    const password = "Password123!";
    await registerViaUi(page, email, password);

    await page.goto("/listings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("listings-search-q").fill(marker);
    await page.getByTestId("listings-page-size").selectOption("96");
    await page.getByTestId("listings-search-submit").click();
    await expect.poll(async () => page.getByTestId("listing-card").count()).toBeGreaterThanOrEqual(96);

    const titlesNewest = await page.getByTestId("listing-card").locator(".line-clamp-1").allTextContents();

    await page.getByTestId("listings-page-size").selectOption("24");
    await page.getByTestId("listings-search-submit").click();
    await expect.poll(async () => page.getByTestId("listing-card").count()).toBeLessThanOrEqual(24);

    await page.getByTestId("listings-sort").selectOption("price_asc");
    await page.getByTestId("listings-search-submit").click();
    await expect.poll(async () => page.getByTestId("listing-card").count()).toBeGreaterThan(0);

    const titlesPrice = await page.getByTestId("listing-card").locator(".line-clamp-1").allTextContents();
    expect(titlesPrice[0]).not.toBe(titlesNewest[0]);
  });

  test("fraud API: forced fraud scoring + landlord fraud queue + ban blocks further requests", async ({
    request,
  }, testInfo) => {
    test.skip(
      process.env.OCH_E2E_BOOKING_FORCE_FRAUD !== "1" && process.env.OCH_E2E_BOOKING_FORCE_FRAUD !== "true",
      "Set OCH_E2E_BOOKING_FORCE_FRAUD=1 alongside BOOKING_E2E_FORCE_FRAUD on booking-service.",
    );

    const stamp = Date.now();
    const landlordTok = await registerToken(request, "och-fraud-landlord", testInfo.workerIndex);
    const tenantTok = await registerToken(request, "och-fraud-tenant", testInfo.workerIndex);
    const listingId = await createListing(request, landlordTok, stamp);
    const tenantId = userIdFromJwt(tenantTok);
    const day = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const fraudScores: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await request.post(`${e2eApiBase()}/api/booking/request`, {
        headers: { Authorization: `Bearer ${tenantTok}` },
        data: {
          listing_id: listingId,
          renter_id: tenantId,
          requested_date: day,
          message: `rapid ${i}`,
        },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      const j = (await r.json()) as { fraud_score?: number };
      fraudScores.push(Number(j.fraud_score ?? 0));
    }
    expect(Math.min(...fraudScores)).toBeGreaterThan(60);

    const fraudList = await request.get(`${e2eApiBase()}/api/booking/fraud-cases?minScore=60&pageSize=24`, {
      headers: { Authorization: `Bearer ${landlordTok}` },
    });
    expect(fraudList.ok(), await fraudList.text()).toBeTruthy();
    const fc = (await fraudList.json()) as { cases?: { booking_id: string }[] };
    expect((fc.cases ?? []).length).toBeGreaterThan(0);
    const bid = fc.cases![0]!.booking_id;

    const ban = await request.post(`${e2eApiBase()}/api/booking/fraud-cases/${bid}/action`, {
      headers: { Authorization: `Bearer ${landlordTok}` },
      data: { action: "ban" },
    });
    expect(ban.ok(), await ban.text()).toBeTruthy();

    const blocked = await request.post(`${e2eApiBase()}/api/booking/request`, {
      headers: { Authorization: `Bearer ${tenantTok}` },
      data: {
        listing_id: listingId,
        renter_id: tenantId,
        requested_date: day,
        message: "after ban",
      },
    });
    expect(blocked.status()).toBe(403);
  });
});
