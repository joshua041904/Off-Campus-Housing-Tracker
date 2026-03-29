import { expect, test } from "@playwright/test";
import {
  apiGatewayHealthy,
  apiGatewayReady,
  firstListingIdFromSearch,
  registerViaUi,
  uniqueE2eEmail,
} from "./helpers";

test.describe("Listings filters & maps", () => {
  test("guest sees extended search filters and sort controls", async ({ page }) => {
    await page.goto("/listings");
    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    const sort = page.getByTestId("listings-sort");
    test.skip((await sort.count()) === 0, "edge webapp build predates filter UI — redeploy webapp to run this assertion");
    await expect(sort).toBeVisible();
    await expect(page.getByTestId("listings-new-within")).toBeVisible();
    await expect(page.getByTestId("listings-filter-furnished")).toBeVisible();
    await expect(page.getByTestId("listings-filter-garage")).toBeVisible();
  });

  test("create listing with coordinates + garage; map area shows embed or key placeholder", async ({
    page,
    request,
  }) => {
    test.slow();
    test.skip(!(await apiGatewayReady(request)), "gateway not ready");

    const email = uniqueE2eEmail("geo-listing", test.info().workerIndex);
    await registerViaUi(page, email, "TestPass123!");

    await page.goto("/listings");
    test.skip(
      (await page.getByPlaceholder(/42\.3910/i).count()) === 0,
      "edge webapp build predates lat/lng create fields — redeploy webapp",
    );
    const post = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Post a listing$/ }) });
    await post.locator("input").first().fill(`Map test ${Date.now()}`);
    await post.locator("textarea").fill("Near campus with parking.");
    await post.locator('input[type="number"]').fill("950");
    await post.locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));

    const latBox = page.getByPlaceholder(/42\.3910/i);
    const lngBox = page.getByPlaceholder(/-72\.5267/i);
    await latBox.fill("42.391");
    await lngBox.fill("-72.527");

    await post.getByRole("checkbox", { name: /^Garage$/ }).check();

    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/listings/create") && resp.status() === 201,
        { timeout: 90_000 },
      ),
      post.getByRole("button", { name: /Create listing/i }).click(),
    ]);
    await expect(page.getByTestId("listing-created-banner")).toBeVisible({ timeout: 45_000 });

    const garageFilter = page.getByTestId("listings-filter-garage");
    if ((await garageFilter.count()) > 0) {
      await garageFilter.check();
      await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes("/api/listings/search") && resp.status() === 200,
        ),
        page.getByTestId("listings-search-submit").click(),
      ]);
    } else {
      await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes("/api/listings/search") && resp.status() === 200,
        ),
        page.getByTestId("listings-search-submit").click(),
      ]);
    }
    await expect(page.getByTestId("listings-results")).toContainText("Map test", { timeout: 25_000 });

    await expect(
      page.getByTestId("map-embed-iframe").or(page.getByTestId("map-embed-placeholder")).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("smoke-free filter can be applied without API error", async ({ page, request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");
    await page.goto("/listings");
    await page.getByTestId("listings-results").waitFor({ state: "visible" });
    await page.locator('label:has-text("Smoke-free")').first().locator('input[type="checkbox"]').check();
    await page.getByTestId("listings-search-submit").click();
    await expect(page.locator('[data-testid="listings-api-error"]')).toHaveCount(0);
    await expect(page.getByTestId("listings-results")).toBeVisible();
  });

  test("guest sees browse UI but not post form (log in CTA)", async ({ page, request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");
    await page.goto("/listings");
    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /^Browse listings$/ })).toBeVisible();
    await expect(page.getByTestId("listings-search-form")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /^Log in$/ })).toBeVisible();
    await expect(page.getByTestId("listings-create-title")).toHaveCount(0);
  });

  test("keyword, price range, sort, and recency filters submit without API error", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");
    await page.goto("/listings");
    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });

    await page.getByTestId("listings-search-q").fill("studio e2e");
    await page.locator('label:has-text("Min price")').locator("..").locator('input[type="number"]').fill("100");
    await page.locator('label:has-text("Max price")').locator("..").locator('input[type="number"]').fill("5000");
    await page.getByTestId("listings-sort").selectOption("price_asc");
    await page.getByTestId("listings-new-within").selectOption("30");
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/listings/search") && resp.status() === 200,
        { timeout: 120_000 },
      ),
      page.getByTestId("listings-search-submit").click(),
    ]);

    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    await expect(page.locator('[data-testid="listings-api-error"]')).toHaveCount(0);
  });

  test("laundry + dishwasher amenity filters submit without API error", async ({ page, request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");
    await page.goto("/listings");
    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });

    const form = page.getByTestId("listings-search-form");
    if ((await page.getByTestId("listings-filter-laundry").count()) > 0) {
      await page.getByTestId("listings-filter-laundry").check();
      await page.getByTestId("listings-filter-dishwasher").check();
    } else {
      await form.locator('label:has-text("In-unit laundry")').locator('input[type="checkbox"]').check();
      await form.locator('label:has-text("Dishwasher")').locator('input[type="checkbox"]').check();
    }
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/listings/search") && resp.status() === 200,
      ),
      page.getByTestId("listings-search-submit").click(),
    ]);
    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(page.locator('[data-testid="listings-api-error"]')).toHaveCount(0);
  });

  test("load listing by ID shows JSON detail", async ({ page, request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");
    const id = await firstListingIdFromSearch(request);
    test.skip(!id, "no listings in search index — seed or create listings first");

    await page.goto("/listings");
    await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });

    const detailInput = page.getByTestId("listings-detail-id").or(page.getByPlaceholder("listing UUID"));
    await detailInput.fill(id);
    const idLower = id.toLowerCase();
    const detailRespP = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/listings/listings/") &&
        resp.url().toLowerCase().includes(idLower) &&
        resp.request().method() === "GET",
    );
    await Promise.all([
      detailRespP,
      page.getByTestId("listings-detail-load").or(page.getByRole("button", { name: /^Load$/ })).click(),
    ]);
    const detailResp = await detailRespP;
    expect(detailResp.ok(), await detailResp.text()).toBeTruthy();
    const detailPre = page
      .getByTestId("listings-detail-json")
      .or(page.locator("pre").filter({ hasText: id.slice(0, 8) }));
    await expect(detailPre).toBeVisible({ timeout: 25_000 });
    await expect(detailPre).toContainText(`"id"`);
  });

  test("create pet-friendly listing then pet-friendly filter finds it", async ({ page, request }) => {
    test.slow();
    test.skip(!(await apiGatewayReady(request)), "gateway not ready");

    const email = uniqueE2eEmail("pet-listing", test.info().workerIndex);
    await registerViaUi(page, email, "TestPass123!");

    await page.goto("/listings");
    test.skip(
      (await page.getByTestId("listings-create-title").count()) === 0,
      "edge webapp predates create form — redeploy webapp",
    );

    const title = `Pet e2e ${Date.now()}`;
    await page.getByTestId("listings-create-title").fill(title);
    await page.getByTestId("listings-create-desc").fill("Cats ok.");
    await page.getByTestId("listings-create-price").fill("1200");
    await page.getByTestId("listings-create-effective-from").fill(new Date().toISOString().slice(0, 10));
    await page.locator('section').filter({ has: page.getByRole("heading", { name: /^Post a listing$/ }) }).getByRole("checkbox", { name: /^Pet-friendly$/ }).check();
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/listings/create") && resp.status() === 201,
      ),
      page.getByTestId("listings-create-submit").click(),
    ]);
    await expect(page.getByTestId("listing-created-banner")).toBeVisible({ timeout: 45_000 });

    await page.locator('label:has-text("Pet-friendly")').first().locator('input[type="checkbox"]').check();
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/listings/search") && resp.status() === 200,
      ),
      page.getByTestId("listings-search-submit").click(),
    ]);
    await expect(page.getByTestId("listings-results")).toContainText(title, { timeout: 25_000 });
    await expect(page.locator('[data-testid="listings-api-error"]')).toHaveCount(0);
  });
});
