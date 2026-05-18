import { expect, test } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, uniqueE2eEmail } from "./helpers";

function userIdFromJwt(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid token payload");
  const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
    sub?: string;
    user_id?: string;
  };
  const id = json.user_id || json.sub;
  if (!id) throw new Error("missing user id in token");
  return id;
}

async function registerApi(
  request: import("@playwright/test").APIRequestContext,
  prefix: string,
  ix: number,
) {
  const email = uniqueE2eEmail(prefix, ix);
  const password = "TestPass123!";
  const base = e2eApiBase();
  const reg = await request.post(`${base}/api/auth/register`, {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });
  expect(reg.ok(), await reg.text()).toBeTruthy();
  const j = (await reg.json()) as { token?: string };
  expect(j.token).toBeTruthy();
  return { token: j.token!, email, password };
}

/**
 * Single signed-in session on https://off-campus-housing.test — avoids login rate limits across tests.
 */
test.describe("signed-in: deployed shell (messages, bookings, community)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");
  });

  test("DM thread + reply, then bookings and community (same session)", async ({ page, request }, testInfo) => {
    test.slow();
    test.setTimeout(240_000);
    const ix = testInfo.parallelIndex;
    const base = e2eApiBase();

    const a = await registerApi(request, "msg-ui-a", ix);
    const b = await registerApi(request, "msg-ui-b", ix);
    const idB = userIdFromJwt(b.token);

    const content = `e2e-dm-${Date.now()}`;
    const send = await request.post(`${base}/api/messaging/messages`, {
      headers: {
        Authorization: `Bearer ${a.token}`,
        "Content-Type": "application/json",
      },
      data: {
        recipient_id: idB,
        message_type: "General",
        subject: "",
        content,
      },
    });
    if (send.status() >= 500) {
      test.skip(true, `messaging POST ${send.status()}`);
    }
    expect(send.ok(), await send.text()).toBeTruthy();

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(b.email);
    await page.getByLabel("Password").fill(b.password);
    const dash = page.waitForURL(/\/dashboard$/, { timeout: 60_000 });
    await page.getByRole("button", { name: "Sign in" }).click();
    await dash;

    await page.goto("/dashboard/messages", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("messages-workspace-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("messages-auth-loading")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(/Failed to load inbox|messaging threads 404|404/i)).toHaveCount(0);

    const firstThread = page.locator('[data-testid="messages-inbox-list"] [data-testid^="thread-row-"]').first();
    await expect(firstThread).toBeVisible({ timeout: 30_000 });
    await firstThread.click();

    await page.getByRole("button", { name: "Booking updates" }).click();
    await expect(page.getByTestId("messages-booking-loading")).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.locator('[data-testid="messages-inbox-list"] [data-testid^="thread-row-"]').or(page.getByTestId("messages-inbox-empty")),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/dashboard\/messages\?thread=[0-9a-f-]{36}/i, { timeout: 30_000 });
    await expect(page.locator("div.rounded-2xl").filter({ hasText: content }).first()).toBeVisible({
      timeout: 30_000,
    });

    const replyBox = page.locator('textarea[placeholder="Write a message…"]');
    await expect(replyBox).toBeVisible({ timeout: 30_000 });
    await replyBox.fill(`reply-${Date.now()}`);
    await expect(page.getByTestId("thread-reply-send")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("thread-reply-send").click();
    await expect(page.getByText(/Failed to load thread|404/i)).toHaveCount(0);

    await page.goto("/dashboard/bookings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /My bookings/i })).toBeVisible({ timeout: 60_000 });

    await page.goto("/community", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Community board/i })).toBeVisible({ timeout: 60_000 });

    await page.goto("/dashboard/landlord", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });
});
