import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("booking (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/booking/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/booking/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("POST /api/booking/create without auth → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/booking/create"), {
      data: { listing_id: "00000000-0000-0000-0000-000000000001", start: "2026-01-01", end: "2026-01-02" },
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBe(401);
  });

  test("POST /api/booking/create invalid JWT → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/booking/create"), {
      data: { listing_id: "00000000-0000-0000-0000-000000000001", start: "2026-01-01", end: "2026-01-02" },
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("POST /api/booking/create empty JSON → 4xx", async ({ request }) => {
    const r = await request.post(edgePath("/api/booking/create"), {
      data: {},
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });
});
