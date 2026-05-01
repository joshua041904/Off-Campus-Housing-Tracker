import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";

test("dashboard and booking redirect unauthenticated users to login", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  await page.goto("/booking");
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
});

test("home shows CTA to register", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /One place to search|off-campus housing crunch|Built for the off-campus/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" }).first()).toBeVisible();
});

test("listings and trust pages render for guests", async ({ page, request }) => {
  test.skip(
    !(await apiGatewayHealthy(request)),
    "edge API not reachable — set E2E_API_BASE / NEXT_PUBLIC_API_BASE to the edge and ensure /api/listings is up"
  );

  await page.goto("/listings");
  await expect(page.getByRole("heading", { name: /Browse listings/i })).toBeVisible();
  await expect(page.getByTestId("listings-results")).toBeVisible();
  await expect(page.getByTestId("listings-results")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
  // Empty DB is valid; cards if seeded; upstream errors may show both empty copy and listings-api-error — avoid strict .or().
  const results = page.getByTestId("listings-results");
  await expect
    .poll(
      async () => {
        if (await page.getByTestId("listings-api-error").isVisible()) return "ok";
        if (await results.getByText(/No listings match|empty index/i).isVisible()) return "ok";
        if (await results.locator("div.font-medium").first().isVisible()) return "ok";
        return null;
      },
      { timeout: 15_000 },
    )
    .toBe("ok");

  await page.goto("/trust");
  await expect(page.getByRole("heading", { name: /Trust & safety/i })).toBeVisible();
  await expect(page.getByTestId("trust-reputation-form")).toBeVisible();
});
