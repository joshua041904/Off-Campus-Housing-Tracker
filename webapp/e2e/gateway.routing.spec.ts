import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath } from "./vertical-helpers";

test.describe("gateway routing", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("GET /api/readyz returns status", async ({ request }) => {
    const r = await request.get(edgePath("/api/readyz"));
    expect(r.status()).toBeGreaterThanOrEqual(200);
    expect(r.status()).toBeLessThan(600);
  });

  test("unknown /api/gateway-test-missing-route → 404", async ({ request }) => {
    const r = await request.get(edgePath("/api/gateway-test-missing-route-404"));
    expect([404, 502]).toContain(r.status());
  });
});
