import { expect, test } from "@playwright/test";
import { apiGatewayHealthy, e2eApiBase } from "./helpers";

test.describe("Analytics API (gateway)", () => {
  test("GET daily-metrics returns JSON", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge API not reachable — set E2E_API_BASE and ensure https://off-campus-housing.test (or override) resolves");
    const base = e2eApiBase();
    const date = new Date().toISOString().slice(0, 10);
    const r = await request.get(`${base}/api/analytics/daily-metrics?date=${encodeURIComponent(date)}`);
    expect(r.ok(), await r.text()).toBeTruthy();
    const body = (await r.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("date");
  });

  test("POST listing-feel returns analysis (Ollama or stub)", async ({ request }) => {
    test.slow();
    test.skip(!(await apiGatewayHealthy(request)), "api-gateway not reachable");
    const base = e2eApiBase();
    const r = await request.post(`${base}/api/analytics/insights/listing-feel`, {
      data: {
        title: "k6-e2e studio",
        description: "Near campus, quiet",
        price_cents: 95000,
        audience: "renter",
      },
      headers: { "Content-Type": "application/json" },
      timeout: 120_000,
    });
    const raw = await r.text();
    if (r.status() === 401 && raw.includes("auth required")) {
      test.skip(
        true,
        "Gateway image is old: POST /api/analytics/insights/listing-feel still requires JWT. Rebuild/redeploy api-gateway with OPEN_ROUTES for listing-feel."
      );
    }
    expect(r.ok(), raw).toBeTruthy();
    const body = (await r.json()) as { analysis_text?: string; model_used?: string };
    expect(body.analysis_text || body.model_used).toBeTruthy();
  });
});
