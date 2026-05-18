import { expect, test } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, uniqueE2eEmail } from "./helpers";

async function loginToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const base = e2eApiBase();
  const res = await request.post(`${base}/api/auth/login`, {
    data: { email, password },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const data = (await res.json()) as { token?: string; access_token?: string };
  const token = data.token || data.access_token;
  expect(token).toBeTruthy();
  return String(token);
}

test.describe("notification read persistence across sessions", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayReady(request)), "gateway /api/readyz not OK");
  });

  test("mark-context-read then fresh login keeps landlord unread at 0 when siblings exist", async ({
    page,
    request,
  }, testInfo) => {
    test.slow();
    const email = uniqueE2eEmail("notif-read", testInfo.parallelIndex);
    const password = "TestPass123!";
    const base = e2eApiBase();

    const reg = await request.post(`${base}/api/auth/register`, {
      data: { email, password },
      headers: { "Content-Type": "application/json" },
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();

    const tokenA = await loginToken(request, email, password);
    const tokenB = await loginToken(request, email, password);

    const unreadA = await request.get(`${base}/api/notification/notifications/unread-count?scope=landlord`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(unreadA.ok()).toBeTruthy();
    const unreadCount = ((await unreadA.json()) as { unreadCount?: number }).unreadCount ?? 0;
    if (unreadCount === 0) {
      test.skip(true, "no landlord notifications to validate read persistence");
    }

    const listRes = await request.get(`${base}/api/notification/notifications?scope=landlord&limit=50`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const items = ((await listRes.json()) as { items?: Array<{ payload?: Record<string, unknown> }> }).items ?? [];
    const bookingId = String(
      items.find((row) => row.payload && typeof row.payload.booking_id === "string")?.payload?.booking_id ?? "",
    ).trim();
    if (!bookingId) {
      test.skip(true, "no booking notifications for mark-context-read");
    }

    const markRes = await request.post(`${base}/api/notification/notifications/mark-context-read`, {
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      data: { context_type: "booking", booking_id: bookingId },
    });
    expect(markRes.ok(), await markRes.text()).toBeTruthy();

    const unreadAfter = await request.get(`${base}/api/notification/notifications/unread-count?scope=landlord`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(unreadAfter.ok()).toBeTruthy();
    expect(((await unreadAfter.json()) as { unreadCount?: number }).unreadCount).toBe(0);

    const listAfter = await request.get(`${base}/api/notification/notifications?scope=landlord&limit=50`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(listAfter.ok()).toBeTruthy();
    const siblings = ((await listAfter.json()) as { items?: Array<{ payload?: Record<string, unknown>; read_at?: string | null }> })
      .items?.filter((row) => String(row.payload?.booking_id ?? "") === bookingId);
    expect(siblings?.length).toBeGreaterThan(0);
    expect(siblings?.every((row) => row.read_at)).toBe(true);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });
});
