import { expect, test } from "@playwright/test";
import { apiGatewayReady, registerViaUi, uniqueE2eEmail } from "./helpers";

/** Heavy flow (booking + listings + trust); serial avoids overlapping with other infra-heavy tests in the same worker pool. */
test.describe.configure({ mode: "serial" });

test("register → search history → watchlist add/remove (needs full stack)", async ({ page, request }) => {
  test.skip(
    !(await apiGatewayReady(request)),
    "gateway /api/readyz not OK — auth gRPC not verified (kubectl logs deploy/api-gateway; auth-service). Port-forward alone is not enough if auth is down."
  );

  const email = uniqueE2eEmail("e2e", test.info().workerIndex);
  const password = "TestPass123!";

  await registerViaUi(page, email, password);

  // Dashboard disables submit while initial search-history + watchlist refresh runs.
  await expect(page.getByTestId("search-submit")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("search-query").fill("studio near campus e2e");
  await page.getByTestId("search-max-km").fill("4");
  await expect(page.getByTestId("search-submit")).toBeEnabled({ timeout: 10_000 });
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/booking/search-history") &&
        !r.url().includes("search-history/list") &&
        r.request().method() === "POST" &&
        (r.status() === 200 || r.status() === 201),
      { timeout: 60_000 },
    ),
    page.getByTestId("search-submit").click(),
  ]);
  await expect(page.getByText(/Search saved to history/i)).toBeVisible({ timeout: 30_000 });

  // Table should list the row we just saved (refresh avoids any residual race with initial load fetch).
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("search-history")).toContainText("studio near campus e2e", {
    timeout: 20_000,
  });

  const listingId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await page.getByTestId("watchlist-listing-id").fill(listingId);
  await page.getByTestId("watchlist-add").click();
  await expect(page.getByText(/added to watchlist/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("watchlist-items")).toContainText(listingId);

  await page.getByTestId(`watchlist-remove-${listingId}`).click();
  await expect(page.getByText(/removed from watchlist/i)).toBeVisible({ timeout: 15_000 });

  await page.goto("/listings");
  await expect(page.getByRole("heading", { name: /Browse listings/i })).toBeVisible();
  await page.getByTestId("listings-search-q").fill("e2e");
  await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes("/api/listings/search") && resp.status() === 200,
    ),
    page.getByTestId("listings-search-submit").click(),
  ]);
  await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("listings-results")).toBeVisible({ timeout: 15_000 });

  await page.goto("/trust");
  await page.getByTestId("trust-reputation-user-id").fill("00000000-0000-4000-8000-000000000001");
  await page.getByTestId("trust-reputation-submit").click();
  await expect(page.getByTestId("trust-reputation-score")).toBeVisible({ timeout: 15_000 });
});
