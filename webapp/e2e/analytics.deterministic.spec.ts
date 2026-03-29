import { expect, test } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, registerViaUi, uniqueE2eEmail } from "./helpers";

function calendarDateYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.describe("Analytics deterministic projection", () => {
  test("create listing increases daily new_listings (ANALYTICS_SYNC_MODE on cluster)", async ({
    page,
    request,
  }) => {
    test.slow();
    test.setTimeout(240_000);
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");

    const email = uniqueE2eEmail("an-det", test.info().workerIndex);
    await registerViaUi(page, email, "TestPass123!");

    const today = calendarDateYmd();
    const base = e2eApiBase();
    const dailyUrl = `${base}/api/analytics/daily-metrics?date=${encodeURIComponent(today)}`;
    const beforeRes = await request.get(dailyUrl);
    expect(beforeRes.ok(), await beforeRes.text()).toBeTruthy();
    const before = Number(((await beforeRes.json()) as { new_listings?: number }).new_listings) || 0;

    await page.goto("/listings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Post a listing/i })).toBeVisible({ timeout: 60_000 });
    const post = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Post a listing$/ }) });
    const slug = `det-${Date.now()}`;
    await post.locator("input").first().fill(`Analytics det ${slug}`);
    await post.locator("textarea").fill("Deterministic projection E2E.");
    await post.locator('input[type="number"]').fill("900");
    await post.locator('input[type="date"]').fill(today);
    await post.getByRole("button", { name: /Create listing/i }).click();
    await expect(page.getByTestId("listing-created-banner")).toBeVisible({ timeout: 60_000 });

    await expect
      .poll(
        async () => {
          const r = await request.get(dailyUrl);
          if (!r.ok()) return before;
          const j = (await r.json()) as { new_listings?: number };
          return Number(j.new_listings) || 0;
        },
        { timeout: 90_000, intervals: [500, 1_000, 2_000, 3_000, 5_000] },
      )
      .toBeGreaterThan(before);
  });
});
