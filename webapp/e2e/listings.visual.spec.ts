import { test, expect } from "@playwright/test";

const populatedListings = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    title: "2 Bed near campus",
    description: "Walkable and furnished",
    price_cents: 120000,
    listed_at: "2026-04-20",
    smoke_free: true,
    pet_friendly: true,
    furnished: true,
    amenities: ["parking", "dishwasher"],
    latitude: null,
    longitude: null,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Studio downtown",
    description: "Close to transit",
    price_cents: 95000,
    listed_at: "2026-04-18",
    smoke_free: false,
    pet_friendly: false,
    furnished: true,
    amenities: ["in_unit_laundry"],
    latitude: null,
    longitude: null,
  },
];

// Test on both desktop and mobile viewports
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`listings page visual states [${viewport.name}]`, () => {
    test.use({
      baseURL: process.env.VISUAL_TEST_BASE_URL || "http://localhost:3000",
      viewport: { width: viewport.width, height: viewport.height },
    });

    test.beforeEach(async ({ page }) => {
      // Block ALL external requests for full network isolation
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (
          url.startsWith("http://localhost") ||
          url.startsWith("http://127.0.0.1")
        ) {
          await route.continue();
        } else {
          await route.abort();
        }
      });
    });

    test(`populated results [${viewport.name}]`, async ({ page }) => {
      await page.route("**/api/listings/search*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(populatedListings),
        });
      });

      await page.goto("/listings");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("listings-results")).toBeVisible();
      await expect(page.getByText("2 Bed near campus")).toBeVisible();

      await expect(page.getByTestId("listings-results")).toHaveScreenshot(
        `listings-results-populated-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.005 },
      );
    });

    test(`empty results [${viewport.name}]`, async ({ page }) => {
      await page.route("**/api/listings/search*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      });

      await page.goto("/listings");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("listings-results")).toBeVisible();

      await expect(page.getByTestId("listings-results")).toHaveScreenshot(
        `listings-results-empty-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.005 },
      );
    });

    test(`error state [${viewport.name}]`, async ({ page }) => {
      await page.route("**/api/listings/search*", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "listings search 500" }),
        });
      });

      await page.goto("/listings");
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("listings-results")).toBeVisible();

      await expect(page.getByTestId("listings-results")).toHaveScreenshot(
        `listings-results-error-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.005 },
      );
    });
  });
}
