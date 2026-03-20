import { expect, test } from "@playwright/test";

test("dashboard redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("home shows CTA to register", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Search, history/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register" }).first()).toBeVisible();
});
