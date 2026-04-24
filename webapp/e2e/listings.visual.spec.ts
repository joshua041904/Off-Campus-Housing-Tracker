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

test.describe("listings page visual states", () => {
  test.beforeEach(() => {
    test.skip(
      process.env.E2E_API_BASE === undefined,
      "Requires running webapp/edge environment",
    );
  });
  test("populated results", async ({ page }) => {
    await page.route("**/api/listings/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(populatedListings),
      });
    });

    await page.goto("/listings");

    // wait for correct state
    await expect(page.getByTestId("listings-results")).toBeVisible();
    await expect(page.getByText("Available listings")).toBeVisible();
    await expect(page.getByText("2 listings found")).toBeVisible();

    // snapshot
    await expect(page.getByTestId("listings-results")).toHaveScreenshot(
      "listings-results-populated.png",
    );
  });

  test("empty results", async ({ page }) => {
    await page.route("**/api/listings/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/listings");

    // wait for correct state
    await expect(page.getByTestId("listings-results")).toBeVisible();
    await expect(
      page.getByText("No listings matched your current filters."),
    ).toBeVisible();

    // snapshot
    await expect(page.getByTestId("listings-results")).toHaveScreenshot(
      "listings-results-empty.png",
    );
  });

  test("error state", async ({ page }) => {
    await page.route("**/api/listings/search*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "listings search 500" }),
      });
    });

    await page.goto("/listings");

    // wait for correct state
    await expect(page.getByTestId("listings-results")).toBeVisible();
    await expect(page.getByText("Could not load listings")).toBeVisible();

    // snapshot
    await expect(page.getByTestId("listings-results")).toHaveScreenshot(
      "listings-results-error.png",
    );
  });
});
