import type { Span } from "@opentelemetry/api";
import type { IncomingMessage } from "node:http";
import type { Request } from "express";

/** Normalize Caddy `{http.request.proto}` or short forms to h1 | h2 | h3 | unknown. */
export function canonicalNetProtoFromEdgeHeader(raw: string | undefined): string {
  if (raw == null || String(raw).trim() === "") return "unknown";
  const t = String(raw).trim().toLowerCase();
  if (t === "h1" || t === "http/1.0" || t === "http/1.1") return "h1";
  if (t === "h2" || t === "http/2" || t === "http/2.0") return "h2";
  if (t === "h3" || t === "http/3") return "h3";
  if (t.includes("http/3")) return "h3";
  if (t.includes("http/2")) return "h2";
  if (t.includes("http/1")) return "h1";
  return "unknown";
}

function expressHeaderFirst(req: Request, name: string): string | undefined {
  if (typeof req.get !== "function") return undefined;
  const v = req.get(name);
  if (v == null || v === "") return undefined;
  return String(v).split(",")[0]?.trim();
}

/**
 * Edge client protocol when present (Caddy `X-OCH-Edge-Proto`), else optional lab hint (`X-OCH-Transport`),
 * else Node's HTTP version for this hop (gateway→service is often h1).
 */
export function inferNetProtoForSpan(req: Request): string {
  const edge = canonicalNetProtoFromEdgeHeader(expressHeaderFirst(req, "x-och-edge-proto"));
  if (edge !== "unknown") return edge;
  const lab = canonicalNetProtoFromEdgeHeader(expressHeaderFirst(req, "x-och-transport"));
  if (lab !== "unknown") return lab;
  const v = (req as { httpVersion?: string }).httpVersion;
  if (v === "2.0") return "h2";
  if (v === "1.1" || v === "1.0") return "h1";
  return "unknown";
}

export function inferNetProtoFromIncomingMessage(req: IncomingMessage): string {
  const h = req.headers;
  const pick = (k: string): string | undefined => {
    const x = h[k.toLowerCase()];
    if (typeof x === "string") return x.split(",")[0]?.trim();
    if (Array.isArray(x) && x[0]) return String(x[0]).split(",")[0]?.trim();
    return undefined;
  };
  const edge = canonicalNetProtoFromEdgeHeader(pick("x-och-edge-proto"));
  if (edge !== "unknown") return edge;
  const lab = canonicalNetProtoFromEdgeHeader(pick("x-och-transport"));
  if (lab !== "unknown") return lab;
  const v = req.httpVersion;
  if (v === "2.0") return "h2";
  if (v === "1.1" || v === "1.0") return "h1";
  return "unknown";
}

export function applyDebugReplayHeaderToSpan(span: Span, req: Request): void {
  const v = expressHeaderFirst(req, "x-debug-replay")?.toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "step7") {
    span.setAttribute("debug.replay", true);
  }
}

export function applyDebugReplayFromIncomingHeaders(span: Span, req: IncomingMessage): void {
  const raw = req.headers["x-debug-replay"];
  const s = Array.isArray(raw) ? raw[0] : raw;
  const v = String(s ?? "")
    .trim()
    .toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "step7") {
    span.setAttribute("debug.replay", true);
  }
}

/** Set `net.proto` + optional `debug.replay` on the request span (call right after startSpan). */
export function decorateHttpSpanWithTransport(span: Span, req: Request): void {
  span.setAttribute("net.proto", inferNetProtoForSpan(req));
  applyDebugReplayHeaderToSpan(span, req);
}

export function decorateIncomingMessageSpanWithTransport(span: Span, req: IncomingMessage): void {
  span.setAttribute("net.proto", inferNetProtoFromIncomingMessage(req));
  applyDebugReplayFromIncomingHeaders(span, req);
}
