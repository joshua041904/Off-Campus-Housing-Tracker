import { expect, test, type APIRequestContext } from "@playwright/test";

async function gatewayHealthy(request: APIRequestContext): Promise<boolean> {
  const base = process.env.E2E_API_BASE || "http://127.0.0.1:4020";
  try {
    const r = await request.get(`${base}/api/healthz`);
    return r.ok();
  } catch {
    return false;
  }
}

test("register → search history → watchlist add/remove (needs full stack)", async ({ page, request }) => {
  test.skip(
    !(await gatewayHealthy(request)),
    "api-gateway not reachable — start stack or set E2E_API_BASE (see webapp/README.md)"
  );

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = "TestPass123!";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator('[data-testid="register-form"]').getByRole("button", { name: "Register" }).click();

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await page.getByTestId("search-query").fill("studio near campus e2e");
  await page.getByTestId("search-max-km").fill("4");
  await page.getByTestId("search-submit").click();
  await expect(page.getByText(/Search saved to history/i)).toBeVisible({ timeout: 15_000 });

  await expect(page.getByTestId("search-history")).toContainText("studio near campus e2e");

  const listingId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await page.getByTestId("watchlist-listing-id").fill(listingId);
  await page.getByTestId("watchlist-add").click();
  await expect(page.getByText(/added to watchlist/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("watchlist-items")).toContainText(listingId);

  await page.getByTestId(`watchlist-remove-${listingId}`).click();
  await expect(page.getByText(/removed from watchlist/i)).toBeVisible({ timeout: 15_000 });
});
