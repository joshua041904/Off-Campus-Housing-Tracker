import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath } from "./vertical-helpers";

type ListingItem = {
  id?: string;
  title?: string;
  description?: string | null;
  price_cents?: number;
};

test.describe("Listings search filters", () => {
  test("applies keyword + price range + sort and renders filtered results", async ({ page, request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");

    const seedResp = await request.get(edgePath("/api/listings/search"), { timeout: 20_000 });
    test.skip(!seedResp.ok(), "seed listings search unavailable");

    const seedJson = (await seedResp.json()) as { items?: ListingItem[] };
    const seedItems = seedJson.items ?? [];
    test.skip(seedItems.length === 0, "no listings available to validate filters");

    const seed =
      seedItems.find((i) => /\w{3,}/.test(String(i.title ?? ""))) ??
      seedItems[0];
    const keyword = String(seed.title ?? "").split(/\s+/).find((w) => w.length >= 3) ?? "listing";
    const seedPriceCents = Number(seed.price_cents ?? 0);
    const minPriceDollars = Math.max(0, Math.floor(seedPriceCents / 100) - 1);
    const maxPriceDollars = Math.max(
      minPriceDollars + 1,
      Math.ceil(seedPriceCents / 100) + 1,
    );

    await page.goto("/listings");
    const results = page.getByTestId("listings-results");
    test.skip((await results.count()) === 0, "edge webapp build predates listings testids");

    await expect(results).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });

    await page.getByTestId("listings-search-q").fill(keyword);
    await page
      .locator('label:has-text("Min price")')
      .locator("..")
      .locator('input[type="number"]')
      .fill(String(minPriceDollars));
    await page
      .locator('label:has-text("Max price")')
      .locator("..")
      .locator('input[type="number"]')
      .fill(String(maxPriceDollars));
    await page.getByTestId("listings-sort").selectOption("price_desc");

    const searchResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/listings/search") &&
        resp.request().method() === "GET" &&
        resp.status() === 200,
      { timeout: 120_000 },
    );
    await page.getByTestId("listings-search-submit").click();

    const searchResp = await searchResponsePromise;
    expect(searchResp.status()).toBe(200);

    const url = new URL(searchResp.url());
    expect(url.searchParams.get("q")).toBe(keyword);
    expect(url.searchParams.get("min_price")).toBe(String(minPriceDollars * 100));
    expect(url.searchParams.get("max_price")).toBe(String(maxPriceDollars * 100));
    expect(url.searchParams.get("sort")).toBe("price_desc");

    const body = (await searchResp.json()) as { items?: ListingItem[] };
    const items = body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    const prices = items.map((item) => Number(item.price_cents ?? NaN));
    for (const price of prices) {
      expect(price).toBeGreaterThanOrEqual(minPriceDollars * 100);
      expect(price).toBeLessThanOrEqual(maxPriceDollars * 100);
    }
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    }

    await expect(results).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    await expect(page.locator('[data-testid="listings-api-error"]')).toHaveCount(0);

    const firstTitle = String(items[0]?.title ?? "").trim();
    if (firstTitle) {
      await expect(results).toContainText(firstTitle, { timeout: 25_000 });
    } else {
      await expect(results).toBeVisible();
    }
  });
});
