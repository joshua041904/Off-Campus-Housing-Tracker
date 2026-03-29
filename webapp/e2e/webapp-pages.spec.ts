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
    await page.waitForLoadState("domcontentloaded");
    for (const { name, path } of [
      { name: "Listings", path: /\/listings$/ },
      { name: "Trust", path: /\/trust$/ },
      { name: "Analytics", path: /\/analytics$/ },
    ] as const) {
      await Promise.all([
        page.waitForURL(path, { timeout: 45_000 }),
        page.getByRole("link", { name, exact: true }).first().click(),
      ]);
    }
  });
});
