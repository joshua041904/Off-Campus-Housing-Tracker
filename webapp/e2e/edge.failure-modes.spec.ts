import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("edge failure modes", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("invalid Bearer rejected on protected listings create", async ({ request }) => {
    const r = await request.post(edgePath("/api/listings/create"), {
      data: { title: "x", description: "y", price_cents: 1 },
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("malformed JSON body → 4xx on JSON route", async ({ request }) => {
    const r = await request.post(edgePath("/api/auth/login"), {
      data: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });

  test("rate-limit probe: sequential health checks stay 200", async ({ request }) => {
    for (let i = 0; i < 15; i += 1) {
      const r = await request.get(edgePath("/api/healthz"));
      expect(r.ok(), `iteration ${i}`).toBeTruthy();
    }
  });
});
