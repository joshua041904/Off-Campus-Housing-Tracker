/**
 * Optional gateway hardening: global in-flight cap on proxied housing traffic (503 when full)
 * and GET coalescing for analytics daily-metrics (same query string shares one upstream fetch).
 */
import type { Request, RequestHandler, Response, NextFunction } from "express";
import http from "http";
import type { Agent } from "http";

export function proxyInflightMiddleware(maxInflight: number): RequestHandler {
  if (maxInflight <= 0) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  let inflight = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    if (inflight >= maxInflight) {
      res.status(503).json({ error: "overloaded", code: "gateway_backpressure" });
      return;
    }
    inflight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inflight -= 1;
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

export type AnalyticsDailyCoalesceOptions = {
  analyticsHttpBase: string;
  agent: Agent;
};

type DailyMetricsPayload = { statusCode: number; body: Buffer; contentType?: string };

/**
 * Single upstream GET for concurrent identical ?query (e.g. k6 hammering same date).
 */
export function analyticsDailyMetricsCoalescedHandler(opts: AnalyticsDailyCoalesceOptions): RequestHandler {
  const pending = new Map<string, Promise<DailyMetricsPayload>>();

  return async (req: Request, res: Response) => {
    try {
      const url = new URL(req.originalUrl || req.url || "/", "http://gateway.internal");
      const search = url.search || "";
      const key = search || "?";

      let p = pending.get(key);
      if (!p) {
        const base = opts.analyticsHttpBase.replace(/\/$/, "");
        const targetUrl = `${base}/daily-metrics${search}`;

        const created = new Promise<DailyMetricsPayload>((resolve, reject) => {
          http
            .get(targetUrl, { agent: opts.agent }, (incoming) => {
              const chunks: Buffer[] = [];
              incoming.on("data", (c: Buffer) => chunks.push(c));
              incoming.on("end", () => {
                resolve({
                  statusCode: incoming.statusCode || 500,
                  body: Buffer.concat(chunks),
                  contentType: incoming.headers["content-type"] as string | undefined,
                });
              });
              incoming.on("error", reject);
            })
            .on("error", reject);
        });
        p = created.finally(() => {
          pending.delete(key);
        });
        pending.set(key, p);
      }

      const out = await p;
      if (out.contentType) res.setHeader("Content-Type", out.contentType);
      res.status(out.statusCode).send(out.body);
    } catch {
      res.status(502).json({ error: "upstream error", code: "gateway_coalesce_upstream" });
    }
  };
}
