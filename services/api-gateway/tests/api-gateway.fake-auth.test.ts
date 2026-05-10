/**
 * `DEBUG_FAKE_AUTH` middleware: UUID x-user-id branch vs non-UUID (no-op user injection).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { vitestRouteHitAgent } from "./vitest-route-hit-agent.js";

describe("DEBUG_FAKE_AUTH", () => {
  let app: import("express").Express;
  let agent: ReturnType<typeof vitestRouteHitAgent>;

  beforeAll(async () => {
    process.env.DEBUG_FAKE_AUTH = "1";
    vi.resetModules();
    const mod = await import("../src/server.js");
    app = mod.app;
    agent = vitestRouteHitAgent(app);
  });

  it("still requires bearer on protected routes (fake auth does not bypass guard)", async () => {
    const noHdr = await agent.get("/api/booking/x");
    expect(noHdr.status).toBe(401);
  });

  it("accepts valid UUID in x-user-id header without crashing (middleware branch)", async () => {
    const res = await agent
      .get("/api/booking/x")
      .set("x-user-id", "550e8400-e29b-41d4-a716-446655440000");
    expect(res.status).toBe(401);
  });

  it("non-UUID x-user-id does not set synthetic user", async () => {
    const res = await agent.get("/api/booking/x").set("x-user-id", "not-a-uuid");
    expect(res.status).toBe(401);
  });
});
