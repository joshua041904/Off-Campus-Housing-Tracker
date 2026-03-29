import { expect, test } from "@playwright/test";

/**
 * The webapp does not ship a forum/DM UI yet; messaging is exercised via API integration tests and
 * scripts/test-microservices-http2-http3-housing.sh. This spec only asserts the product copy still
 * reflects the messaging service in the stack (mission page).
 */
test("mission page mentions messaging in architecture copy", async ({ page }) => {
  await page.goto("/mission");
  await expect(page.getByTestId("mission-heading")).toBeVisible();
  await expect(page.getByText(/messaging/i)).toBeVisible();
});
