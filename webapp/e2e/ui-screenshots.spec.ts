/**
 * Writes PNGs under e2e/screenshots/ (full-page). Run manually or in preflight when you want fresh UI captures.
 *   E2E_SCREENSHOTS=1 pnpm exec playwright test e2e/ui-screenshots.spec.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "@playwright/test";

const SCREENSHOT_DIR = path.join(process.cwd(), "e2e", "screenshots");

test.describe("UI screenshots (optional)", () => {
  test("capture key webapp pages", async ({ page }) => {
    test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1 to write PNGs to e2e/screenshots/");
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const shot = async (name: string) => {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
    };

    await page.goto("/");
    await shot("01-home");

    await page.goto("/login");
    await shot("02-login");

    await page.goto("/register");
    await shot("03-register");

    await page.goto("/listings");
    await shot("04-listings-guest");

    const detailLink = page.getByRole("button", { name: "View Details" }).first();
    if ((await detailLink.count()) > 0) {
      await detailLink.click();
      await shot("04b-listing-detail");
    } else {
      await page.goto("/listings/00000000-0000-0000-0000-000000000000");
      await shot("04b-listing-detail");
    }

    await page.goto("/listings");
    const quickBook = page.getByRole("button", { name: "Book" }).first();
    if ((await quickBook.count()) > 0) {
      await quickBook.click();
      await page.waitForTimeout(600);
      await shot("04c-booking-confirmation");
    } else {
      await shot("04c-booking-confirmation");
    }

    await page.goto("/dashboard/landlord");
    await shot("04d-landlord-dashboard");

    await page.goto("/mission");
    await shot("05-mission");

    await page.goto("/trust");
    await shot("06-trust");

    await page.goto("/analytics");
    await shot("07-analytics");
  });
});
