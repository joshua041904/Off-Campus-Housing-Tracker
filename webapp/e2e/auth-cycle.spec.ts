import { expect, test, type APIRequestContext } from "@playwright/test";

async function gatewayHealthy(request: APIRequestContext): Promise<boolean> {
  const base = process.env.E2E_API_BASE || "http://127.0.0.1:4020";
  try {
    const r = await request.get(`${base}/api/healthz`);
    return r.ok();
  } catch {
    return false;
  }
}

/** Register → sign out → log in again (needs api-gateway + auth + booking for dashboard APIs). */
test("register, sign out, login again", async ({ page, request }) => {
  test.skip(
    !(await gatewayHealthy(request)),
    "api-gateway not reachable — start stack or port-forward (see webapp/README.md)"
  );

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-cycle-${suffix}@example.com`;
  const password = "TestPass123!";

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator('[data-testid="register-form"]').getByRole("button", { name: "Register" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

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
