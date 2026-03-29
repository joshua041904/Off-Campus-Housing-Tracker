import type { NextFunction, Request, Response } from "express";
import pLimit from "p-limit";

const maxConcurrent = Math.max(
  1,
  Number.parseInt(process.env.MESSAGING_HTTP_MAX_CONCURRENT ?? "200", 10) || 200,
);

const limit = pLimit(maxConcurrent);

/**
 * Hard cap on concurrent HTTP requests (including /healthz). When saturated, respond 503 immediately
 * instead of queuing unbounded work — avoids connection reset / EOF cascades under k6 ramp.
 */
export function messagingHttpConcurrencyGuard(req: Request, res: Response, next: NextFunction): void {
  if (limit.activeCount >= maxConcurrent) {
    res
      .status(503)
      .setHeader("Retry-After", "1")
      .json({ error: "server_busy", message: "Server busy" });
    return;
  }

  void limit(
    () =>
      new Promise<void>((resolve, reject) => {
        const done = (): void => {
          resolve();
        };
        res.once("finish", done);
        res.once("close", done);
        try {
          next();
        } catch (err) {
          reject(err);
        }
      }),
  ).catch((err: unknown) => {
    console.error("[messaging] concurrency guard", err);
    if (!res.headersSent) {
      res.status(503).json({ error: "server_busy", message: "Server busy" });
    }
  });
}
