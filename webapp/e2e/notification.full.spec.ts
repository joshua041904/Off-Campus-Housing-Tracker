import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("notification (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/notification/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/notification/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("GET /api/notification/preferences without auth → 401", async ({ request }) => {
    const r = await request.get(edgePath("/api/notification/preferences"));
    expect(r.status()).toBe(401);
  });

  test("GET /api/notification/preferences invalid JWT → 401", async ({ request }) => {
    const r = await request.get(edgePath("/api/notification/preferences"), {
      headers: { Authorization: invalidJwt },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("GET /api/notification/notifications without auth → 401", async ({ request }) => {
    const r = await request.get(edgePath("/api/notification/notifications"));
    expect(r.status()).toBe(401);
  });
});
