import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

test.describe("navbar", () => {
  test.use({
    baseURL: process.env.E2E_API_BASE || "http://localhost:3000",
  });

  for (const viewport of VIEWPORTS) {
    test.describe(`[${viewport.name}]`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`unauthenticated state shows login and register links [${viewport.name}]`, async ({ page }) => {
        await page.goto("/listings");
        await page.waitForLoadState("networkidle");

        const header = page.locator("header");
        await expect(header).toBeVisible();

        // Key nav links present
        await expect(page.getByRole("link", { name: "Listings" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Booking" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Trust" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();

        // Auth links
        await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Register" })).toBeVisible();

        // No sign out button when unauthenticated
        await expect(page.getByTestId("nav-sign-out")).not.toBeVisible();
      });

      test(`active link is highlighted on listings page [${viewport.name}]`, async ({ page }) => {
        await page.goto("/listings");
        await page.waitForLoadState("networkidle");

        const listingsLink = page.getByRole("link", { name: "Listings" });
        await expect(listingsLink).toHaveAttribute("aria-current", "page");
      });

      test(`active link is highlighted on trust page [${viewport.name}]`, async ({ page }) => {
        await page.goto("/trust");
        await page.waitForLoadState("networkidle");

        const trustLink = page.getByRole("link", { name: "Trust" });
        await expect(trustLink).toHaveAttribute("aria-current", "page");
      });

      test(`brand link navigates to home [${viewport.name}]`, async ({ page }) => {
        await page.goto("/listings");
        await page.waitForLoadState("networkidle");

        await page.getByRole("link", { name: /Off-Campus Housing Tracker/i }).click();
        await expect(page).toHaveURL("/");
      });
    });
  }
});
