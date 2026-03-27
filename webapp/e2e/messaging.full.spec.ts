import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("messaging (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/messaging/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/messaging/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("POST /api/messaging/messages without auth → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/messaging/messages"), {
      data: { conversation_id: "00000000-0000-0000-0000-000000000001", body: "hi" },
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBe(401);
  });

  test("POST /api/messaging/messages invalid JWT → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/messaging/messages"), {
      data: { conversation_id: "00000000-0000-0000-0000-000000000001", body: "hi" },
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect([401, 403]).toContain(r.status());
  });
});
