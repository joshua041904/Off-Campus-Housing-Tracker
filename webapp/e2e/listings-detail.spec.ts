import { expect, test } from "@playwright/test";

const listing = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user-1",
  title: "Sunny 2BR near campus",
  description: "Bright apartment with in-unit laundry and parking.",
  price_cents: 220000,
  amenities: ["parking", "in_unit_laundry"],
  smoke_free: true,
  pet_friendly: true,
  furnished: false,
  listed_at: "2026-05-01",
  latitude: null,
  longitude: null,
};

test.describe("listings marketplace detail flow", () => {
  test("navigates from listings grid to listing detail page", async ({
    page,
  }) => {
    await page.route("**/api/listings/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [listing] }),
      });
    });

    await page.route(
      `**/api/listings/listings/${listing.id}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(listing),
        });
      },
    );

    await page.goto("/listings");

    await expect(page.getByText("Sunny 2BR near campus")).toBeVisible();

    await page.getByRole("link", { name: "Sunny 2BR near campus" }).click();

    await expect(page).toHaveURL(new RegExp(`/listings/${listing.id}$`));
    await expect(
      page.getByRole("heading", { name: listing.title }),
    ).toBeVisible();
    await expect(
      page.getByText("Bright apartment with in-unit laundry and parking."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save listing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Analyze listing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start booking" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Message landlord/i }),
    ).toBeDisabled();
  });

  test("shows feedback when saving requires login", async ({ page }) => {
    await page.route(
      `**/api/listings/listings/${listing.id}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(listing),
        });
      },
    );

    await page.goto(`/listings/${listing.id}`);

    await page.getByRole("button", { name: "Save listing" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "You must be logged in to save listings.",
    );
  });

  test("renders listing analysis from analytics API", async ({ page }) => {
    await page.route(
      `**/api/listings/listings/${listing.id}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(listing),
        });
      },
    );

    await page.route(
      "**/api/analytics/insights/listing-feel",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            analysis_text: "This listing looks like a strong renter fit.",
            model_used: "test-model",
          }),
        });
      },
    );

    await page.goto(`/listings/${listing.id}`);

    await page.getByRole("button", { name: "Analyze listing" }).click();

    await expect(
      page.getByRole("button", { name: "Analyzing..." }),
    ).toBeVisible();
    await expect(page.getByText("Listing analysis generated.")).toBeVisible();
    await expect(
      page.getByText("This listing looks like a strong renter fit."),
    ).toBeVisible();
  });

  test("renders not found state for missing listing", async ({ page }) => {
    await page.route(
      "**/api/listings/listings/missing-listing",
      async (route) => {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not found" }),
        });
      },
    );

    await page.goto("/listings/missing-listing");

    await expect(
      page.getByRole("heading", { name: "We could not find that listing." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to listings" }),
    ).toBeVisible();
  });
});
