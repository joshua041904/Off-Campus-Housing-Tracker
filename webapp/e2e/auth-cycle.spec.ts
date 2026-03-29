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
  const loginForm = page.locator('[data-testid="login-form"]');
  await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes("auth/login") &&
        resp.request().method() === "POST" &&
        resp.status() === 200,
      { timeout: 60_000 },
    ),
    // requestSubmit() is more reliable than role click when React state wraps the native submit path.
    loginForm.evaluate((el) => (el as HTMLFormElement).requestSubmit()),
  ]);
  await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });

  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByTestId("analytics-heading")).toBeVisible();
});
