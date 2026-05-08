/**
 * Direct branch coverage for `statusFromGatewayError` (error middleware status mapping).
 * Isolated file so `server.ts` loads once without http-proxy-middleware mocks from exhaustive tests.
 */
import { describe, it, expect, beforeAll } from "vitest";

describe("statusFromGatewayError", () => {
  let statusFromGatewayError: (err: unknown) => number;

  beforeAll(async () => {
    const mod = await import("../src/server.js");
    statusFromGatewayError = mod.statusFromGatewayError;
  });

  it("returns numeric status when err.status is in 4xx/5xx range", () => {
    expect(statusFromGatewayError({ status: 401 })).toBe(401);
    expect(statusFromGatewayError({ status: 403 })).toBe(403);
    expect(statusFromGatewayError({ status: 404 })).toBe(404);
    expect(statusFromGatewayError({ status: 429 })).toBe(429);
    expect(statusFromGatewayError({ status: 500 })).toBe(500);
  });

  it("falls back to statusCode when status is absent", () => {
    expect(statusFromGatewayError({ statusCode: 418 })).toBe(418);
  });

  it("prefers status over statusCode when both set", () => {
    expect(statusFromGatewayError({ status: 409, statusCode: 404 })).toBe(409);
  });

  it("ignores out-of-range or non-numeric status fields", () => {
    expect(statusFromGatewayError({ status: 399 })).toBe(500);
    expect(statusFromGatewayError({ status: 600 })).toBe(500);
    expect(statusFromGatewayError({ status: "404" as unknown as number })).toBe(500);
    expect(statusFromGatewayError({})).toBe(500);
  });

  it("maps SyntaxError to 400", () => {
    expect(statusFromGatewayError(new SyntaxError("bad json"))).toBe(400);
  });

  it("maps PayloadTooLargeError and URIError names to 400", () => {
    const pl = new Error("too big") as Error & { name: string };
    pl.name = "PayloadTooLargeError";
    expect(statusFromGatewayError(pl)).toBe(400);
    const uri = new Error("bad") as Error & { name: string };
    uri.name = "URIError";
    expect(statusFromGatewayError(uri)).toBe(400);
  });

  it("returns 500 for primitives and generic errors", () => {
    expect(statusFromGatewayError(null)).toBe(500);
    expect(statusFromGatewayError(undefined)).toBe(500);
    expect(statusFromGatewayError("oops")).toBe(500);
    expect(statusFromGatewayError(new Error("x"))).toBe(500);
  });
});
