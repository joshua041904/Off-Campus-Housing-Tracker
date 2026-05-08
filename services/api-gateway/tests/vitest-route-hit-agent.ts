import request from "supertest";
import type { Express } from "express";

/**
 * Supertest agent that sends `x-suite: vitest` on every request so api-gateway
 * `route-coverage-middleware` attributes hits to the vitest bucket in
 * `bench_logs/routes-hit.jsonl` (och-service-coverage-matrix per-suite columns).
 */
export function vitestRouteHitAgent(app: Express) {
  return request.agent(app).set("x-suite", "vitest");
}
