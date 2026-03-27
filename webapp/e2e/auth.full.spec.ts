import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("auth (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/auth/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/auth/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("GET /api/auth/me without auth → 401", async ({ request }) => {
    const r = await request.get(edgePath("/api/auth/me"));
    expect(r.status()).toBe(401);
  });

  test("POST /api/auth/validate with invalid JWT → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/auth/validate"), {
      data: { token: "not-a-real-jwt" },
      headers: { "Content-Type": "application/json" },
    });
    expect([400, 401]).toContain(r.status());
  });

  test("POST /api/auth/validate with garbage Authorization → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/auth/validate"), {
      data: {},
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect([400, 401]).toContain(r.status());
  });
});
