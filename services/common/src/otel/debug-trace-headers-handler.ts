import { trace } from "@opentelemetry/api";
import type { Express, Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getIncomingHttpOtelContext } from "./outgoing-http-propagation.js";

function headerFromIncoming(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(",") || null;
  return null;
}

/**
 * JSON body for GET /debug/headers (Express or raw {@link IncomingMessage}).
 */
export function buildDebugTraceHeadersPayload(req: IncomingMessage): Record<string, unknown> {
  const span = trace.getActiveSpan();
  const sc = span?.spanContext();
  return {
    traceId: sc?.traceId,
    spanId: sc?.spanId,
    traceFlags: sc?.traceFlags,
    incoming: {
      traceparent: headerFromIncoming(req, "traceparent"),
      tracestate: headerFromIncoming(req, "tracestate"),
      "x-request-id": headerFromIncoming(req, "x-request-id"),
    },
    hasStashedRequestContext: Boolean(getIncomingHttpOtelContext(req)),
  };
}

export function writeDebugTraceHeadersJson(req: IncomingMessage, res: ServerResponse): void {
  const body = JSON.stringify(buildDebugTraceHeadersPayload(req));
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(body);
}

/**
 * Read-only introspection for trace propagation (edge → gateway → services).
 * Open route: no JWT (same class as full-trace contract).
 */
export function mountDebugTraceHeaders(app: Express): void {
  const handler = (req: Request, res: Response) => {
    res.status(200).json(buildDebugTraceHeadersPayload(req));
  };
  app.get(["/api/debug/headers", "/debug/headers"], handler);
}
