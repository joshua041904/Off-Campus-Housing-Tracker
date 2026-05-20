import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { context, propagation } from "@opentelemetry/api";
import { EventEmitter } from "node:events";
import http from "node:http";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import type { NextFunction, Request, Response } from "express";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildOutgoingHttpHeadersForIncomingMessage } from "./outgoing-http-propagation.js";
import { traceIncomingHttpRequest, tracingMiddleware } from "./http-tracing-middleware.js";

function spanFullyEnded(s: ReadableSpan | undefined): boolean {
  if (!s) return false;
  const t = s.endTime;
  return t[0] !== 0 || t[1] !== 0;
}

/** Poll until the exporter shows a finished span (handles event-loop / socket teardown jitter under load). */
async function waitForExportedFinishedSpan(
  getSpans: () => readonly ReadableSpan[],
  wantName: string,
  timeoutMs: number,
  intervalMs = 25,
): Promise<ReadableSpan> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const spans = getSpans();
    const hit = spans.find((x) => x.name === wantName && spanFullyEnded(x));
    if (hit) return hit;
    if (Date.now() >= deadline) break;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  const spans = getSpans();
  expect(spans, `expected one finished span named ${wantName} within ${timeoutMs}ms`).toHaveLength(1);
  expect(spans[0].name).toBe(wantName);
  expect(spanFullyEnded(spans[0]), "span should be ended (non-zero endTime)").toBe(true);
  return spans[0];
}

describe("HTTP tracing middleware", () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  beforeEach(() => {
    exporter.reset();
  });

  it("ends the span after response finish (Express middleware)", async () => {
    const req = {
      method: "GET",
      path: "/healthz",
      httpVersion: "1.1",
      headers: {} as Request["headers"],
      get(_name: string) {
        return undefined;
      },
    } as Request;

    const res = new EventEmitter() as Response;
    (res as Response & { statusCode: number }).statusCode = 200;

    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
      queueMicrotask(() => res.emit("finish"));
    };

    tracingMiddleware(req, res, next);
    expect(nextCalled).toBe(true);

    await new Promise<void>((r) => setImmediate(r));
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("HTTP GET /healthz");
    expect(spans[0].attributes["och.edge_proto"]).toBe("unknown");
    expect(spans[0].attributes["och.upstream_proto"]).toBe("h1");
    expect(spans[0].attributes["network.protocol.name"]).toBe("http");
    expect(spans[0].attributes["network.protocol.version"]).toBe("unknown");
    expect(spans[0].attributes["net.proto"]).toBe("unknown");
    expect(spans[0].endTime).not.toEqual([0, 0]);
  });

  it("maps X-OCH-Edge-Proto to edge span attributes (not Node hop)", async () => {
    const req = {
      method: "GET",
      path: "/healthz",
      httpVersion: "1.1",
      headers: { "x-och-edge-proto": "HTTP/2.0" } as Request["headers"],
      get(name: string) {
        const k = name.toLowerCase();
        const h = (this as Request).headers;
        const v = h[k];
        if (typeof v === "string") return v;
        if (Array.isArray(v)) return v[0];
        return undefined;
      },
    } as Request;

    const res = new EventEmitter() as Response;
    (res as Response & { statusCode: number }).statusCode = 200;

    const next: NextFunction = () => {
      queueMicrotask(() => res.emit("finish"));
    };

    tracingMiddleware(req, res, next);
    await new Promise<void>((r) => setImmediate(r));
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes["och.edge_proto"]).toBe("h2");
    expect(spans[0].attributes["och.upstream_proto"]).toBe("h1");
    expect(spans[0].attributes["network.protocol.version"]).toBe("2");
    expect(spans[0].attributes["net.proto"]).toBe("h2");
  });

  it("stashes span context on req so W3C inject survives Express async await", async () => {
    const req = {
      method: "GET",
      path: "/api/debug/full-trace",
      httpVersion: "1.1",
      headers: {} as Request["headers"],
      get(_name: string) {
        return undefined;
      },
    } as Request;

    const res = new EventEmitter() as Response;
    (res as Response & { statusCode: number }).statusCode = 200;

    const next: NextFunction = async () => {
      await Promise.resolve();
      const h = buildOutgoingHttpHeadersForIncomingMessage(req);
      expect(h.traceparent, "inject must use request-stashed context after await").toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[12]/);
      queueMicrotask(() => res.emit("finish"));
    };

    tracingMiddleware(req, res, next);
    await new Promise<void>((r) => setImmediate(r));
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("HTTP GET /api/debug/full-trace");
  });

  it(
    "ends the span after response finish (raw Node http)",
    async () => {
      const server = http.createServer(async (req, res) => {
        const path = req.url?.split("?")[0] || "/";
        await traceIncomingHttpRequest(req, res, path, async () => {
          res.statusCode = 200;
          res.end("ok");
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => resolve());
        server.on("error", reject);
      });
      const addr = server.address();
      if (addr == null || typeof addr === "string") throw new Error("expected TCP address");
      const response = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
      await response.arrayBuffer();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      const s = await waitForExportedFinishedSpan(() => exporter.getFinishedSpans(), "HTTP GET /healthz", 12_000);
      expect(s.endTime).not.toEqual([0, 0]);
    },
    20_000,
  );
});
