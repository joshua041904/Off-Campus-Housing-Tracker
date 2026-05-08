import express from "express";
import http from "node:http";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { createClusterWeightBudgetMiddleware, gatewayRouteWeight } from "../src/cluster-weight-budget";

describe("gatewayRouteWeight", () => {
  it("assigns higher weight to messaging-like segments", () => {
    const mk = (url: string) => ({ originalUrl: url, method: "GET" } as import("express").Request);
    expect(gatewayRouteWeight(mk("/api/messaging/x"))).toBe(5);
    expect(gatewayRouteWeight(mk("/messaging/x"))).toBe(5);
    expect(gatewayRouteWeight(mk("/api/listings/x"))).toBe(1);
    expect(gatewayRouteWeight(mk("/api/unknown-xyz/x"))).toBe(1);
  });
});

describe("createClusterWeightBudgetMiddleware", () => {
  it("passes through when redis is not open", async () => {
    const redis = { isOpen: false, eval: vi.fn() };
    const app = express();
    app.use(createClusterWeightBudgetMiddleware({ redis: redis as any, key: "k", cap: 10 }));
    app.get("/api/booking/x", (_req, res) => res.send("ok"));
    const res = await request(app).get("/api/booking/x");
    expect(res.status).toBe(200);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("passes through on OPTIONS (traffic skip)", async () => {
    const redis = { isOpen: true, eval: vi.fn() };
    const app = express();
    app.use(createClusterWeightBudgetMiddleware({ redis: redis as any, key: "k", cap: 10 }));
    app.options("/api/booking/x", (_req, res) => res.status(204).end());
    const res = await request(app).options("/api/booking/x");
    expect(res.status).toBe(204);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("returns 503 when Lua budget returns 0", async () => {
    const redis = {
      isOpen: true,
      eval: vi.fn().mockResolvedValue(0),
    };
    const app = express();
    app.use(createClusterWeightBudgetMiddleware({ redis: redis as any, key: "k", cap: 1 }));
    app.get("/api/messaging/x", (_req, res) => res.send("ok"));
    const res = await request(app).get("/api/messaging/x");
    expect(res.status).toBe(503);
    expect(res.body?.error).toBe("cluster_weight_exceeded");
  });

  it("calls next when budget acquired and releases on finish", async () => {
    const redis = {
      isOpen: true,
      eval: vi.fn().mockResolvedValue(1),
    };
    const app = express();
    app.use(createClusterWeightBudgetMiddleware({ redis: redis as any, key: "k", cap: 500 }));
    app.get("/api/booking/x", (_req, res) => res.send("ok"));
    const res = await request(app).get("/api/booking/x");
    expect(res.status).toBe(200);
    expect(redis.eval).toHaveBeenCalled();
  });

  it("fail-open when redis.eval throws", async () => {
    const redis = {
      isOpen: true,
      eval: vi.fn().mockRejectedValue(new Error("redis down")),
    };
    const app = express();
    app.use(createClusterWeightBudgetMiddleware({ redis: redis as any, key: "k", cap: 10 }));
    app.get("/api/booking/x", (_req, res) => res.send("ok"));
    const res = await request(app).get("/api/booking/x");
    expect(res.status).toBe(200);
  });
});

describe("analyticsDailyMetricsCoalescedHandler integration", () => {
  it("coalesces concurrent GETs with identical query string", async () => {
    const { analyticsDailyMetricsCoalescedHandler } = await import("../src/proxy-limits.js");
    const { Agent } = await import("node:http");

    let upstreamHits = 0;
    const upstream = await new Promise<http.Server>((resolve, reject) => {
      const s = http.createServer((req, res) => {
        upstreamHits += 1;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, q: req.url }));
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    const addr = upstream.address();
    if (!addr || typeof addr === "string") throw new Error("addr");
    const base = `http://127.0.0.1:${addr.port}`;

    const app = express();
    const agent = new Agent({ keepAlive: true });
    app.get("/daily-metrics", analyticsDailyMetricsCoalescedHandler({ analyticsHttpBase: base, agent }));

    const port = await new Promise<number>((resolve, reject) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => {
        const a = s.address();
        if (a && typeof a !== "string") resolve(a.port);
        else reject(new Error("no port"));
      });
    });

    const url = `http://127.0.0.1:${port}/daily-metrics?date=2020-01-01`;
    const [a, b] = await Promise.all([
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http.get(url, { agent }, (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => resolve({ status: r.statusCode || 0, body: Buffer.concat(chunks).toString() }));
        }).on("error", reject);
      }),
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http.get(url, { agent }, (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => resolve({ status: r.statusCode || 0, body: Buffer.concat(chunks).toString() }));
        }).on("error", reject);
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(upstreamHits).toBe(1);

    await new Promise<void>((r) => upstream.close(() => r()));
  });
});
