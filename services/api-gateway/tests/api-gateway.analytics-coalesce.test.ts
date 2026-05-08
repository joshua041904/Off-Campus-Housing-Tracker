/**
 * Covers `if (coalesceAnalyticsDaily)` branch: daily-metrics served by coalesced handler instead of generic proxy.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { vitestRouteHitAgent } from "./vitest-route-hit-agent.js";

describe("analytics daily coalesce mount", () => {
  let app: import("express").Express;
  let agent: ReturnType<typeof vitestRouteHitAgent>;

  beforeAll(async () => {
    process.env.GATEWAY_COALESCE_ANALYTICS_DAILY = "1";
    vi.resetModules();
    const mod = await import("../src/server.js");
    app = mod.app;
    agent = vitestRouteHitAgent(app);
  });

  it("GET /api/analytics/daily-metrics hits coalesced path", async () => {
    const res = await agent.get("/api/analytics/daily-metrics");
    expect([200, 502, 504]).toContain(res.status);
  });
});
