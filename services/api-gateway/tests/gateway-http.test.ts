import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vitestRouteHitAgent } from "./vitest-route-hit-agent.js";

describe("api-gateway HTTP (no listen)", () => {
  let app: import("express").Express;
  let agent: ReturnType<typeof vitestRouteHitAgent>;

  beforeAll(async () => {
    const mod = await import("../src/server");
    app = mod.app;
    agent = vitestRouteHitAgent(app);
  });

  afterAll(() => {
    // allow redis background from server module to settle
  });

  it("GET /healthz returns 200", async () => {
    const res = await agent.get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it("GET /readyz is OK when auth upstream verify skipped in tests", async () => {
    const res = await agent.get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body?.authUpstream).toBe(true);
  });

  it("GET /api/media/public/:id without Authorization is not blocked by JWT guard (img tags)", async () => {
    const res = await agent.get(
      "/api/media/public/00000000-0000-4000-8000-000000000000?e=1&s=invalid-signature-for-test",
    );
    expect(res.status).not.toBe(401);
  });
});
