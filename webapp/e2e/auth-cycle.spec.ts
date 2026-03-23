import { expect, test } from "@playwright/test";
import { apiGatewayReady, registerViaUi, uniqueE2eEmail } from "./helpers";

/** Register → sign out → log in again (needs api-gateway + auth + booking for dashboard APIs). */
test("register, sign out, login again", async ({ page, request }) => {
  test.skip(
    !(await apiGatewayReady(request)),
    "gateway /api/readyz not OK — auth gRPC not verified (see webapp/README.md)"
  );

  const email = uniqueE2eEmail("e2e-cycle", test.info().workerIndex);
  const password = "TestPass123!";

  await registerViaUi(page, email, password);

  await page.getByTestId("nav-sign-out").click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator('[data-testid="login-form"]').getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByTestId("analytics-heading")).toBeVisible();
});
