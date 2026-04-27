import { test, expect } from "@playwright/test";

test.describe("trust page interactions", () => {
  test.beforeEach(async () => {
    test.skip(
      process.env.E2E_API_BASE === undefined,
      "Requires running webapp/edge environment",
    );
  });
  test("reputation lookup success", async ({ page }) => {
    await page.route("**/api/trust/reputation*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user_id: "123", score: 5 }),
      });
    });

    await page.goto("/trust");

    await page.getByPlaceholder("user UUID").fill("123");
    await page.getByTestId("trust-reputation-submit").click();

    await expect(page.getByText(/Reputation for/)).toBeVisible();
  });

  test("reputation lookup error", async ({ page }) => {
    await page.route("**/api/trust/reputation*", async (route) => {
      await route.fulfill({
        status: 500,
        body: JSON.stringify({ error: "fail" }),
      });
    });

    await page.goto("/trust");

    await page.getByPlaceholder("user UUID").fill("123");
    await page.getByTestId("trust-reputation-submit").click();

    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("feedback resets on new action", async ({ page }) => {
    let first = true;

    await page.route("**/api/trust/reputation*", async (route) => {
      if (first) {
        first = false;
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ user_id: "123", score: 5 }),
        });
      } else {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: "fail" }),
        });
      }
    });

    await page.goto("/trust");

    const input = page.getByPlaceholder("user UUID");
    const submit = page.getByTestId("trust-reputation-submit");

    await input.fill("123");
    await submit.click();

    await expect(page.getByText(/Reputation for/)).toBeVisible();

    // second action → should clear success and show error
    await submit.click();

    await expect(page.getByRole("alert")).toBeVisible();
  });
});
