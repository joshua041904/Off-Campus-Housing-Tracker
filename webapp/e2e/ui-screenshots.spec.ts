/**
 * Writes PNGs under e2e/screenshots/ (full-page). Run manually or in preflight when you want fresh UI captures.
 *   E2E_SCREENSHOTS=1 pnpm exec playwright test e2e/ui-screenshots.spec.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "@playwright/test";

const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

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

    await page.goto("/mission");
    await shot("05-mission");

    await page.goto("/trust");
    await shot("06-trust");

    await page.goto("/analytics");
    await shot("07-analytics");
  });
});
