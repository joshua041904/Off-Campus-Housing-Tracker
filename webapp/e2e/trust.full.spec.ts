import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("trust (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/trust/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/trust/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("GET /api/trust/reputation/:userId (public read)", async ({ request }) => {
    const r = await request.get(edgePath("/api/trust/reputation/00000000-0000-0000-0000-000000000001"));
    expect([200, 404]).toContain(r.status());
  });

  test("POST /api/trust/report-abuse without auth → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/trust/report-abuse"), {
      data: { target_user_id: "00000000-0000-0000-0000-000000000001", reason: "spam" },
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBe(401);
  });

  test("POST /api/trust/peer-review without auth → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/trust/peer-review"), {
      data: { reviewee_id: "00000000-0000-0000-0000-000000000001", score: 5 },
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBe(401);
  });

  test("POST /api/trust/report-abuse invalid JWT → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/trust/report-abuse"), {
      data: { target_user_id: "00000000-0000-0000-0000-000000000001", reason: "spam" },
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect([401, 403]).toContain(r.status());
  });
});
