import { expect, test } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, uniqueE2eEmail } from "./helpers";

async function registerAndLogin(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, prefix: string, ix: number) {
  const email = uniqueE2eEmail(prefix, ix);
  const password = "TestPass123!";
  const base = e2eApiBase();
  const reg = await request.post(`${base}/api/auth/register`, {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const dash = page.waitForURL(/\/dashboard$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Sign in" }).click();
  await dash;
  return { email, password };
}

test.describe("cold-load dashboard surfaces", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");
  });

  test("messages and booking updates visible without refresh", async ({ page, request }, testInfo) => {
    test.slow();
    await registerAndLogin(page, request, "cold-msg", testInfo.parallelIndex);
    await page.goto("/dashboard/messages", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("messages-workspace-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("messages-auth-loading")).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.locator('[data-testid="messages-inbox-list"] [data-testid^="thread-row-"]').or(
        page.getByTestId("messages-inbox-empty"),
      ),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Booking updates" }).click();
    await expect(page.getByTestId("messages-booking-loading")).toHaveCount(0, { timeout: 30_000 });
  });

  test("notifications feed visible without refresh", async ({ page, request }, testInfo) => {
    test.slow();
    await registerAndLogin(page, request, "cold-notif", testInfo.parallelIndex);
    await page.goto("/dashboard/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("notifications-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("page-auth-loading")).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.getByTestId("notifications-feed").or(page.getByTestId("notifications-table-skeleton")),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("notifications-table-skeleton")).toHaveCount(0, { timeout: 30_000 });
  });

  test("notifications stay stable without retry banner when rows visible", async ({ page, request }, testInfo) => {
    test.slow();
    await registerAndLogin(page, request, "cold-notif-stable", testInfo.parallelIndex);
    await page.goto("/dashboard/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("notifications-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("notifications-table-skeleton")).toHaveCount(0, { timeout: 30_000 });

    const feed = page.getByTestId("notifications-feed");
    const hasRow = await feed.locator("[data-testid^='notification-row-']").count();
    if (hasRow > 0) {
      await page.waitForTimeout(10_000);
      await expect(page.getByText("Still syncing. Retrying…")).toHaveCount(0);
      await expect(page.getByTestId("notifications-table-skeleton")).toHaveCount(0);
      await expect(feed).toBeVisible();
    }
  });

  test("listings base grid renders without waiting for reputation", async ({ page }) => {
    await page.goto("/listings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("listings-results")).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId("listings-grid-skeleton").or(page.locator('[data-testid="listings-results"] a[href^="/listings/"]')),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("listings-grid-skeleton")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText("listings search 429")).toHaveCount(0);
    await expect(page.getByText("1200x800")).toHaveCount(0);
  });

  test("landlord dashboard never shows raw 429 debug text", async ({ page, request }, testInfo) => {
    test.slow();
    await registerAndLogin(page, request, "cold-landlord", testInfo.parallelIndex);
    await page.goto("/dashboard/landlord", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("list my listings 429")).toHaveCount(0);
    await expect(page.getByText("notification list 429")).toHaveCount(0);
    await expect(page.getByText("my bookings 429")).toHaveCount(0);
  });
});
