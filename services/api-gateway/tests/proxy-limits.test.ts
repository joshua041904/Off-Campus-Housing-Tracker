import express from "express";
import http from "node:http";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { proxyInflightMiddleware } from "../src/proxy-limits";

function getWithClose(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject)
      .setTimeout(8000, function onTimeout(this: http.ClientRequest) {
        this.destroy();
        reject(new Error("http get timeout"));
      });
  });
}

describe("proxyInflightMiddleware", () => {
  it("no-ops when maxInflight is 0", async () => {
    const app = express();
    app.use(proxyInflightMiddleware(0));
    app.get("/x", (_req, res) => res.send("ok"));
    const res = await request(app).get("/x");
    expect(res.status).toBe(200);
  });

  it("returns 503 when in-flight cap is exceeded (parallel TCP connections)", async () => {
    const app = express();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    app.use(proxyInflightMiddleware(1));
    app.get("/hold", async (_req, res) => {
      await gate;
      res.status(200).send("ok");
    });

    const server = await new Promise<http.Server>((resolve, reject) => {
      const s = http.createServer(app);
      s.listen(0, () => resolve(s));
      s.on("error", reject);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no listen port");
    const base = `http://127.0.0.1:${addr.port}`;

    const first = getWithClose(`${base}/hold`);
    await new Promise((r) => setTimeout(r, 80));
    const second = await getWithClose(`${base}/hold`);
    expect(second.status).toBe(503);
    expect(JSON.parse(second.body).code).toBe("gateway_backpressure");
    release!();
    const fin = await first;
    expect(fin.status).toBe(200);

    await new Promise<void>((r) => server.close(() => r()));
  });
});
