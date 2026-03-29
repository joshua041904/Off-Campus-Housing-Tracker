import type { NextFunction, Request, Response } from "express";
import { skipsGatewayTrafficControls } from "./gateway-traffic-skip.js";
import { getTrafficShaperCapacityFactor } from "./watchdog-throttle-poll.js";

export type E2eTrafficShaperOptions = {
  /** Max concurrent requests allowed through the gateway after this middleware (default 50). */
  maxConcurrent: number;
};

/**
 * Smooths bursty synthetic traffic (Playwright workers) so downstream service concurrency guards see a steadier arrival rate.
 * Enable with **E2E_TRAFFIC_SHAPER=1**. Capacity may be halved when transport-watchdog sets Redis throttle (see watchdog-throttle-poll).
 */
export function createE2eTrafficShaperMiddleware(opts: E2eTrafficShaperOptions): (req: Request, res: Response, next: NextFunction) => void {
  const baseMax = Math.max(1, opts.maxConcurrent);
  let inUse = 0;
  const waiters: Array<() => void> = [];

  const effectiveMax = (): number => {
    const f = getTrafficShaperCapacityFactor();
    return Math.max(4, Math.floor(baseMax * f));
  };

  return function e2eTrafficShaper(req: Request, res: Response, next: NextFunction): void {
    if (skipsGatewayTrafficControls(req)) {
      next();
      return;
    }

    const proceed = (): void => {
      inUse++;
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        inUse--;
        const w = waiters.shift();
        if (w) w();
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    };

    const cap = effectiveMax();
    if (inUse < cap) {
      proceed();
      return;
    }

    if (waiters.length >= 500) {
      res.status(503).setHeader("Retry-After", "1").json({ error: "e2e_shaper_queue_full", message: "Traffic shaper queue saturated" });
      return;
    }
    waiters.push(proceed);
  };
}
