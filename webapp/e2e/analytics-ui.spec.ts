import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";

test.describe("Analytics UI (browser → gateway)", () => {
  test("listing feel: Analyze shows result or API error", async ({ page, request }) => {
    test.slow();
    test.skip(!(await apiGatewayHealthy(request)), "api-gateway not reachable");

    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-heading")).toBeVisible();
    await page.getByTestId("analytics-listing-feel-form").getByRole("button", { name: "Analyze" }).click();
    // Single locator only: a broad .or(getByText(/Ollama/i)) also matched <code>OLLAMA_BASE_URL</code> in the
    // page intro (strict mode: 2 elements). Success path always renders analysis into this test id.
    await expect(page.getByTestId("analytics-feel-output")).toBeVisible({ timeout: 120_000 });
  });
});
