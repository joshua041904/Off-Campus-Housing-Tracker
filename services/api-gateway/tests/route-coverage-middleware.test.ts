import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyTraffic, routeCoverageMiddleware, TrafficClass } from "../src/route-coverage-middleware";
import type { Request } from "express";

function mockReq(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name: string) => lower[name.toLowerCase()] ?? "" } as Request;
}

describe("classifyTraffic", () => {
  it("returns SUITE when x-suite is set", () => {
    expect(classifyTraffic(mockReq({ "x-suite": "vitest" }))).toBe(TrafficClass.SUITE);
  });
  it("returns INFRA for x-traffic-class infra", () => {
    expect(classifyTraffic(mockReq({ "x-traffic-class": "infra" }))).toBe(TrafficClass.INFRA);
  });
  it("returns INTERNAL for x-traffic-class internal", () => {
    expect(classifyTraffic(mockReq({ "x-traffic-class": "internal" }))).toBe(TrafficClass.INTERNAL);
  });
  it("returns USER when unlabeled", () => {
    expect(classifyTraffic(mockReq({}))).toBe(TrafficClass.USER);
  });
});

describe("routeCoverageMiddleware", () => {
  let covDir: string;
  let covFile: string;

  async function readCovLogAfterRequest(): Promise<string> {
    for (let i = 0; i < 100; i++) {
      if (existsSync(covFile)) {
        const raw = await readFile(covFile, "utf8");
        if (raw.trim()) return raw;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`expected coverage log at ${covFile}`);
  }

  beforeEach(() => {
    covDir = mkdtempSync(join(tmpdir(), "och-route-cov-"));
    covFile = join(covDir, "hits.jsonl");
    process.env.GATEWAY_ROUTE_COVERAGE_LOG = "1";
    process.env.GATEWAY_ROUTE_COVERAGE_FILE = covFile;
    process.env.OCH_ENFORCE_X_SUITE = "0";
  });

  afterEach(async () => {
    delete process.env.GATEWAY_ROUTE_COVERAGE_LOG;
    delete process.env.GATEWAY_ROUTE_COVERAGE_FILE;
    delete process.env.OCH_ENFORCE_X_SUITE;
    if (existsSync(covDir)) await rm(covDir, { recursive: true, force: true });
  });

  it("logs route hit with x-suite on response finish", async () => {
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/probe", (_req, res) => res.status(204).end());

    await request(app).get("/probe").set("x-suite", "vitest");

    const raw = await readCovLogAfterRequest();
    const line = raw.trim().split("\n").pop();
    expect(line).toBeTruthy();
    const rec = JSON.parse(line!);
    expect(rec.method).toBe("GET");
    expect(rec.path).toContain("/probe");
    expect(rec.suite).toBe("vitest");
  });

  it("maps unknown x-suite to unknown", async () => {
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/z", (_req, res) => res.status(200).end());
    await request(app).get("/z").set("x-suite", "custom-unknown");
    const raw = await readCovLogAfterRequest();
    const rec = JSON.parse(raw.trim().split("\n").pop()!);
    expect(rec.suite).toBe("unknown");
  });

  it("does not log when x-suite is missing (suite-only JSONL)", async () => {
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/y", (_req, res) => res.status(200).end());
    await request(app).get("/y");
    expect(existsSync(covFile)).toBe(false);
  });

  it("treats unlabeled traffic as user lane (no 400, no suite log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/app-route", (_req, res) => res.status(200).end());
    const res = await request(app).get("/app-route");
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

  it("allows x-traffic-class: infra without x-suite when strict (no log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/api/auth/healthz", (_req, res) => res.status(200).end());
    const res = await request(app).get("/api/auth/healthz").set("x-traffic-class", "infra");
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

  it("allows x-traffic-class: internal without x-suite when strict (no log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/healthz", (_req, res) => res.status(200).end());
    const res = await request(app).get("/healthz").set("x-traffic-class", "internal");
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

  it("allows /healthz without x-suite when strict only for kube-probe UA (no log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/healthz", (_req, res) => res.status(200).end());
    const res = await request(app).get("/healthz").set("User-Agent", "kube-probe/1.29");
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

  it("allows non-probe with x-suite when OCH_ENFORCE_X_SUITE=1", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/z2", (_req, res) => res.status(200).end());
    await request(app).get("/z2").set("x-suite", "bash");
    const raw = await readCovLogAfterRequest();
    const rec = JSON.parse(raw.trim().split("\n").pop()!);
    expect(rec.suite).toBe("bash");
  });

  it("allows text/html Accept without x-suite when strict (no log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/spa", (_req, res) => res.status(200).end());
    const res = await request(app).get("/spa").set("Accept", "text/html,application/xhtml+xml");
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

  it("allows browser JSON fetch headers without x-suite when strict (no log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/api/listings", (_req, res) => res.status(200).json({ ok: true }));
    const res = await request(app)
      .get("/api/listings")
      .set("Accept", "application/json")
      .set("sec-fetch-mode", "cors")
      .set("sec-fetch-dest", "empty")
      .set(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      );
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

  it("allows kube-probe User-Agent without x-suite when strict (no log)", async () => {
    process.env.OCH_ENFORCE_X_SUITE = "1";
    const app = express();
    app.use(routeCoverageMiddleware());
    app.get("/kube-style", (_req, res) => res.status(200).end());
    const res = await request(app).get("/kube-style").set("User-Agent", "kube-probe/1.29");
    expect(res.status).toBe(200);
    expect(existsSync(covFile)).toBe(false);
  });

});
