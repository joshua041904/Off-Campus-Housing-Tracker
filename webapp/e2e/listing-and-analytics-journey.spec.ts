import { expect, test } from "@playwright/test";
import { apiGatewayHealthy, apiGatewayReady, registerViaUi, uniqueE2eEmail } from "./helpers";

test.describe("Register → listing → analytics (two audiences)", () => {
  test("guest listings surface shows login CTA for posting", async ({ page, request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not reachable");
    await page.goto("/listings");
    const browseHeading = page.getByRole("heading", { name: /Browse listings/i });
    test.skip(
      (await browseHeading.count()) === 0,
      "edge webapp build predates current listings guest UI — redeploy webapp",
    );
    await expect(browseHeading).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /^Log in$/ })).toBeVisible();
    await expect(page.getByRole("main").getByText(/to post a listing/i)).toBeVisible();
  });

  test("register → create listing → find it in search → renter vs landlord listing feel", async ({ page, request }) => {
    test.slow();
    test.setTimeout(240_000);
    test.skip(
      !(await apiGatewayReady(request)),
      "gateway /api/readyz not OK — need auth + listings gRPC through edge"
    );

    const email = uniqueE2eEmail("listing-journey", test.info().workerIndex);
    const password = "TestPass123!";
    const slug = `e2e-${Date.now()}`;

    await registerViaUi(page, email, password);

    await page.goto("/listings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Browse listings/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Post a listing/i })).toBeVisible({ timeout: 60_000 });

    // Scope to the authenticated block — works before/after data-testid deploy (cluster may lag local source).
    const post = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Post a listing$/ }) });
    await post.locator("input").first().fill(`Quiet studio ${slug}`);
    await post.locator("textarea").fill("Near campus, laundry in unit.");
    await post.locator('input[type="number"]').fill("1100");
    await post.locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes("/api/listings/create") && resp.status() === 201,
        { timeout: 90_000 },
      ),
      post.getByRole("button", { name: /Create listing/i }).click(),
    ]);
    await expect(page.getByTestId("listing-created-banner")).toBeVisible({ timeout: 45_000 });

    await page.getByTestId("listings-search-q").fill(slug);
    await page.getByTestId("listings-search-submit").click();
    await expect(page.getByTestId("listings-results")).toContainText(slug, { timeout: 25_000 });

    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: /Analytics & insights/i })).toBeVisible();

    const feelForm = page.locator("form").filter({ has: page.getByRole("button", { name: /^Analyze$/ }) });
    await feelForm.getByRole("radio", { name: /Renter view/i }).check();
    await feelForm.getByRole("button", { name: /^Analyze$/ }).click();
    await expect(page.getByTestId("analytics-feel-output")).toBeVisible({ timeout: 120_000 });
    const renterText = await page.getByTestId("analytics-feel-output").textContent();
    expect((renterText ?? "").trim().length).toBeGreaterThan(4);

    await feelForm.getByRole("radio", { name: /Landlord view/i }).check();
    await feelForm.getByRole("button", { name: /^Analyze$/ }).click();
    await expect(page.getByTestId("analytics-feel-output")).toBeVisible({ timeout: 120_000 });
    const landlordText = await page.getByTestId("analytics-feel-output").textContent();
    expect((landlordText ?? "").trim().length).toBeGreaterThan(4);
  });
});
