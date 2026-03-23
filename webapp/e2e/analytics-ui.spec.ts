import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";

test.describe("Analytics UI (browser → gateway)", () => {
  test("listing feel: Analyze shows result or API error", async ({ page, request }) => {
    test.slow();
    test.skip(!(await apiGatewayHealthy(request)), "api-gateway not reachable");

    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-heading")).toBeVisible();
    await page.getByTestId("analytics-listing-feel-form").getByRole("button", { name: "Analyze" }).click();
    await expect(
      page
        .getByTestId("analytics-feel-output")
        .or(page.getByRole("main").getByText(/listing feel|Failed|fetch|Ollama|internal|502|503/i)),
    ).toBeVisible({ timeout: 120_000 });
  });
});
