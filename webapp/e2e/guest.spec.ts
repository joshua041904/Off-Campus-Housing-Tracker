import { expect, test } from "@playwright/test";

test("dashboard redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
});

test("home shows CTA to register", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /off-campus housing crunch/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" }).first()).toBeVisible();
});

test("listings and trust pages render for guests", async ({ page }) => {
  await page.goto("/listings");
  await expect(page.getByRole("heading", { name: /Browse listings/i })).toBeVisible();
  await expect(page.getByTestId("listings-results")).toBeVisible();

  await page.goto("/trust");
  await expect(page.getByRole("heading", { name: /Trust & safety/i })).toBeVisible();
  await expect(page.getByTestId("trust-reputation-form")).toBeVisible();
});
