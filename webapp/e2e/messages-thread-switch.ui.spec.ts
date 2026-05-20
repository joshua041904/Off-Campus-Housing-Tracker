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

async function register(
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

test.describe("messages: thread switch UX (no wrong-thread flicker)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");
  });

  test("switching inbox rows shows skeleton or target content (never stale overlay on wrong bubbles)", async ({
    page,
    request,
  }, testInfo) => {
    test.slow();
    test.setTimeout(240_000);
    const ix = testInfo.parallelIndex;
    const base = e2eApiBase();

    const a = await register(request, "msg-sw-a", ix);
    const b = await register(request, "msg-sw-b", ix);
    const c = await register(request, "msg-sw-c", ix);
    const idB = userIdFromJwt(b.token);
    const idC = userIdFromJwt(c.token);

    const t1 = Date.now();
    const sendB = await request.post(`${base}/api/messaging/messages`, {
      headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
      data: {
        recipient_id: idB,
        message_type: "General",
        subject: "",
        content: `thread-b-${t1}`,
      },
    });
    expect(sendB.ok(), await sendB.text()).toBeTruthy();
    const sendC = await request.post(`${base}/api/messaging/messages`, {
      headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
      data: {
        recipient_id: idC,
        message_type: "General",
        subject: "",
        content: `thread-c-${t1}`,
      },
    });
    expect(sendC.ok(), await sendC.text()).toBeTruthy();

    const threadsProbe = await request.get(`${base}/api/messaging/threads`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    expect(threadsProbe.ok(), await threadsProbe.text()).toBeTruthy();
    const inbox = (await threadsProbe.json()) as { threads?: Array<{ id?: string }> };
    expect((inbox.threads ?? []).length, "sender inbox should list both DMs").toBeGreaterThanOrEqual(2);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(a.email);
    await page.getByLabel("Password").fill(a.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });

    await page.goto("/dashboard/messages", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("messages-workspace-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Failed to load inbox|messaging threads 404|404/i)).toHaveCount(0);

    const rowB = page.getByRole("button", { name: new RegExp(`thread-b-${t1}`) });
    const rowC = page.getByRole("button", { name: new RegExp(`thread-c-${t1}`) });
    await expect(rowB).toBeVisible({ timeout: 60_000 });
    await expect(rowC).toBeVisible({ timeout: 60_000 });

    const bubbleB = page.locator("div.rounded-2xl").filter({ hasText: `thread-b-${t1}` });
    const bubbleC = page.locator("div.rounded-2xl").filter({ hasText: `thread-c-${t1}` });

    await rowB.click();
    await expect(page).toHaveURL(/thread=[0-9a-f-]{36}/i, { timeout: 30_000 });
    await expect(bubbleB).toHaveCount(1, { timeout: 30_000 });

    await rowC.click();
    await expect(page.getByText("Loading this conversation…").or(bubbleC)).toBeVisible({ timeout: 8_000 });
    await expect(bubbleC).toHaveCount(1, { timeout: 45_000 });
    await expect(bubbleB).toHaveCount(0);
  });
});
