import { expect, test } from "@playwright/test";

/** Always-on: marketing + static pages (no backend required). */
test.describe("Webapp pages (guest)", () => {
  test("mission page renders", async ({ page }) => {
    await page.goto("/mission");
    await expect(page.getByTestId("mission-heading")).toBeVisible();
  });

  test("analytics page shell renders", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-heading")).toBeVisible();
  });

  test("nav links: home → listings → trust → analytics", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Listings", exact: true }).first().click();
    await expect(page).toHaveURL(/\/listings$/);
    await page.getByRole("link", { name: "Trust", exact: true }).first().click();
    await expect(page).toHaveURL(/\/trust$/);
    await page.getByRole("link", { name: "Analytics", exact: true }).first().click();
    await expect(page).toHaveURL(/\/analytics$/);
  });
});
