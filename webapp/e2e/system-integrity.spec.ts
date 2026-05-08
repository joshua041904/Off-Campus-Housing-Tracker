import { expect, test } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, registerViaUi, uniqueE2eEmail } from "./helpers";

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** UTC calendar YYYY-MM-DD — matches listings-service `formatListedAt` (ISO slice) used for analytics `listed_at_day`. */
function utcDateYmd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

test.describe("system integrity (multi-service vertical)", () => {
  test.describe.configure({ mode: "serial" });

  test("register → listing → analytics daily_metrics → trust flag → notification prefs", async ({
    page,
    request,
  }) => {
    test.slow();
    test.setTimeout(300_000);
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");

    const email = uniqueE2eEmail("sys-int", test.info().workerIndex);
    const password = "TestPass123!";
    const slug = `sysint-${Date.now()}`;

    await registerViaUi(page, email, password);

    const token = await page.evaluate(() => localStorage.getItem("och_token"));
    expect(token, "och_token after register").toBeTruthy();
    const h = authHeaders(token!);

    const today = utcDateYmd();
    const base = e2eApiBase();
    const dailyUrl = `${base}/api/analytics/daily-metrics?date=${encodeURIComponent(today)}`;
    const beforeRes = await request.get(dailyUrl);
    expect(beforeRes.ok(), await beforeRes.text()).toBeTruthy();
    const before = (await beforeRes.json()) as { new_listings?: number };
    const newListingsBefore = Number(before.new_listings) || 0;

    await page.goto("/listings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Post a listing/i })).toBeVisible({ timeout: 60_000 });
    const post = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Post a listing$/ }) });
    await post.locator("input").first().fill(`Integrity suite ${slug}`);
    await post.locator("textarea").fill("Cross-service E2E path.");
    await post.locator('input[type="number"]').fill("1200");
    await post.locator('input[type="date"]').fill(today);
    const createRespPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/listings/create") && resp.status() === 201,
    );
    await Promise.all([createRespPromise, post.getByRole("button", { name: /Create listing/i }).click()]);
    const createRes = await createRespPromise;
    const created = (await createRes.json()) as { listed_at?: string };
    const listedDay = String(created.listed_at ?? "").trim().slice(0, 10);
    expect(
      listedDay === today,
      `listing listed_at day (${listedDay}) must match UTC probe day (${today}) — analytics daily_metrics URL`,
    ).toBeTruthy();

    await expect(page.getByTestId("listing-created-banner")).toBeVisible({ timeout: 60_000 });

    await expect
      .poll(
        async () => {
          const r = await request.get(dailyUrl);
          if (!r.ok()) return newListingsBefore;
          const j = (await r.json()) as { new_listings?: number };
          return Number(j.new_listings) || 0;
        },
        {
          // Listing → Kafka → analytics projection can lag behind UI success.
          timeout: 280_000,
          intervals: [2_000, 3_000, 5_000, 8_000],
        },
      )
      .toBeGreaterThan(newListingsBefore);

    const afterMetricsRes = await request.get(dailyUrl);
    expect(afterMetricsRes.ok(), await afterMetricsRes.text()).toBeTruthy();
    const afterMetrics = (await afterMetricsRes.json()) as { new_listings?: number };
    const newListingsAfter = Number(afterMetrics.new_listings) || 0;
    expect(newListingsAfter, "analytics daily_metrics new_listings must increase after listing create").toBeGreaterThan(
      newListingsBefore,
    );

    const searchR = await request.get(`/api/listings/search?q=${encodeURIComponent(slug)}`, { headers: h });
    expect(searchR.ok(), await searchR.text()).toBeTruthy();
    const searchBody = (await searchR.json()) as { items?: { id: string }[] };
    const listingId = searchBody.items?.[0]?.id;
    expect(listingId, "listing visible in search").toBeTruthy();

    const meR = await request.get("/api/auth/me", { headers: h });
    expect(meR.ok(), await meR.text()).toBeTruthy();
    const me = (await meR.json()) as { sub?: string };
    const userId = me.sub;
    expect(userId, "/api/auth/me sub").toBeTruthy();

    const repBefore = await request.get(`/api/trust/reputation/${userId}`);
    expect(repBefore.ok()).toBeTruthy();
    const repJson = (await repBefore.json()) as { data?: { score?: number } };
    expect(typeof repJson.data?.score).toBe("number");
    const previousScore = Number(repJson.data?.score) || 0;

    const flag = await request.post("/api/trust/report-abuse", {
      headers: { ...h, "Content-Type": "application/json" },
      data: {
        abuse_target_type: "listing",
        target_id: listingId,
        category: "e2e-system-integrity",
        details: "automated cross-service check",
      },
    });
    expect(flag.status(), await flag.text()).toBe(201);

    const repAfter = await request.get(`/api/trust/reputation/${userId}`);
    expect(repAfter.ok()).toBeTruthy();
    const repAfterJson = (await repAfter.json()) as { data?: { score?: number } };
    expect(typeof repAfterJson.data?.score).toBe("number");
    expect(
      Number(repAfterJson.data?.score) || 0,
      "trust reputation score must not regress after report-abuse",
    ).toBeGreaterThanOrEqual(previousScore);

    const prefGet1 = await request.get("/api/notification/preferences", { headers: h });
    expect(prefGet1.ok(), await prefGet1.text()).toBeTruthy();
    const p1 = (await prefGet1.json()) as { email_enabled?: boolean };
    const originalEmailEnabled = Boolean(p1.email_enabled);

    const putOff = await request.put("/api/notification/preferences", {
      headers: { ...h, "Content-Type": "application/json" },
      data: { email_enabled: false },
    });
    expect(putOff.ok(), await putOff.text()).toBeTruthy();
    const prefAfterOff = await request.get("/api/notification/preferences", { headers: h });
    expect(prefAfterOff.ok()).toBeTruthy();
    const offBody = (await prefAfterOff.json()) as { email_enabled?: boolean };
    expect(offBody.email_enabled, "notification prefs: email disabled in DB").toBe(false);

    const putOn = await request.put("/api/notification/preferences", {
      headers: { ...h, "Content-Type": "application/json" },
      data: { email_enabled: true },
    });
    expect(putOn.ok(), await putOn.text()).toBeTruthy();
    const prefAfterOn = await request.get("/api/notification/preferences", { headers: h });
    expect(prefAfterOn.ok()).toBeTruthy();
    const onBody = (await prefAfterOn.json()) as { email_enabled?: boolean };
    expect(onBody.email_enabled, "notification prefs: email re-enabled in DB").toBe(true);

    await request.put("/api/notification/preferences", {
      headers: { ...h, "Content-Type": "application/json" },
      data: { email_enabled: originalEmailEnabled },
    });
  });
});
