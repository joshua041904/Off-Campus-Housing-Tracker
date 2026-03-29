import type { NextFunction, Request, Response } from "express";
import { skipsGatewayTrafficControls } from "./gateway-traffic-skip.js";

function hasE2eTestLabel(req: Request): boolean {
  const v = (req.get("x-test-mode") || req.get("x-e2e-test") || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export type E2eTestModeInflightCapOptions = {
  /** Max concurrent requests that carry X-Test-Mode / x-e2e-test (default 60). */
  maxConcurrent: number;
};

/**
 * Hard cap on **labeled** synthetic traffic only (Playwright sends x-e2e-test + x-test-mode).
 * Over cap → **429** + Retry-After (no queue — failures are explicit, not tail latency).
 * Enable with **GATEWAY_E2E_TEST_INFLIGHT_CAP=1** (often alongside E2E_TRAFFIC_SHAPER).
 */
export function createE2eTestModeInflightCapMiddleware(
  opts: E2eTestModeInflightCapOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const max = Math.max(4, opts.maxConcurrent);
  let inUse = 0;

  return function e2eTestModeInflightCap(req: Request, res: Response, next: NextFunction): void {
    if (skipsGatewayTrafficControls(req)) {
      next();
      return;
    }
    if (!hasE2eTestLabel(req)) {
      next();
      return;
    }

    if (inUse >= max) {
      res.status(429).setHeader("Retry-After", "1").json({
        error: "e2e_test_inflight_cap",
        message: `Too many concurrent E2E-labeled requests (max ${max})`,
      });
      return;
    }

    inUse++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inUse--;
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
