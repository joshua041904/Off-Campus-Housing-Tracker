import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";

describe("auth-service HTTP (no listen)", () => {
  let app: import("express").Express;

  beforeAll(async () => {
    const mod = await import("../src/server");
    app = mod.app;
  });

  it("GET /privacy returns HTML", async () => {
    const res = await request(app).get("/privacy");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Privacy Policy");
  });

  it("GET /terms returns HTML", async () => {
    const res = await request(app).get("/terms");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Terms");
  });

  it("POST /register without body returns validation error", async () => {
    const res = await request(app).post("/register").send({});
    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("VALIDATION_ERROR");
  });

  it("GET /me without Authorization returns 401", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
    expect(res.body?.code).toBe("MISSING_TOKEN");
  });

  it("POST /verify/email/send without email returns 400", async () => {
    const res = await request(app).post("/verify/email/send").send({});
    expect(res.status).toBe(400);
  });
});
