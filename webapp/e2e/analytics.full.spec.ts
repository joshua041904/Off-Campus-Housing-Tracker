import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("analytics (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/analytics/healthz", async ({ request }) => {
    await expect
      .poll(
        async () => {
          const r = await request.get(edgePath("/api/analytics/healthz"));
          return r.status();
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBe(200);
  });

  test("GET /api/analytics/daily-metrics (often public)", async ({ request }) => {
    const date = new Date().toISOString().slice(0, 10);
    const r = await request.get(edgePath(`/api/analytics/daily-metrics?date=${encodeURIComponent(date)}`));
    expect([200, 401, 403, 502]).toContain(r.status());
  });

  test("GET /api/analytics/insights/search-summary/:userId without auth → 401", async ({ request }) => {
    const r = await request.get(
      edgePath("/api/analytics/insights/search-summary/00000000-0000-0000-0000-000000000001"),
    );
    expect([401, 403]).toContain(r.status());
  });

  test("GET /api/analytics/insights/search-summary with invalid JWT → 401", async ({ request }) => {
    const r = await request.get(
      edgePath("/api/analytics/insights/search-summary/00000000-0000-0000-0000-000000000001"),
      { headers: { Authorization: invalidJwt } },
    );
    expect([401, 403]).toContain(r.status());
  });
});
