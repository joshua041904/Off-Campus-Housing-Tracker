import type { Span } from "@opentelemetry/api";
import type { IncomingMessage } from "node:http";
import type { Request } from "express";

/** Canonical edge/client protocol (browser/curl ↔ Caddy). Never infer from Node hop alone. */
export type EdgeProto = "h1" | "h2" | "h3" | "unknown";

/** Upstream wire between reverse-proxy hop and this process (Caddy→gateway, gateway→service, …). */
export type UpstreamProto = "h1" | "h2" | "h2c" | "grpc" | "unknown";

export function normalizeEdgeProto(raw: string | undefined): EdgeProto {
  const v = String(raw || "")
    .toLowerCase()
    .trim();
  if (v === "h3" || v.includes("http/3") || v === "3") return "h3";
  if (v === "h2" || v.includes("http/2") || v === "2") return "h2";
  if (v === "http/1.1" || v === "1.1" || v === "h1") return "h1";
  return "unknown";
}

/** @deprecated Prefer {@link normalizeEdgeProto} — kept for call sites that pass Caddy-style raw values. */
export function canonicalNetProtoFromEdgeHeader(raw: string | undefined): string {
  return normalizeEdgeProto(raw);
}

function expressHeaderFirst(req: Request, name: string): string | undefined {
  if (typeof req.get !== "function") return undefined;
  const v = req.get(name);
  if (v == null || v === "") return undefined;
  return String(v).split(",")[0]?.trim();
}

/**
 * Edge protocol from `X-OCH-Edge-Proto` (Caddy `{http.request.proto}`) or lab `X-OCH-Transport` only.
 * Does **not** fall back to Node `httpVersion` (that is the proxy hop, not the browser edge).
 */
export function edgeProtoFromRequestHeaders(req: Request): EdgeProto {
  const edge = normalizeEdgeProto(expressHeaderFirst(req, "x-och-edge-proto"));
  if (edge !== "unknown") return edge;
  return normalizeEdgeProto(expressHeaderFirst(req, "x-och-transport"));
}

/** Node↔proxy HTTP version for this socket (not the browser edge). */
export function upstreamProtoFromExpressHop(req: Request): UpstreamProto {
  const v = (req as { httpVersion?: string }).httpVersion;
  if (v === "2.0") return "h2";
  if (v === "1.1" || v === "1.0") return "h1";
  return "unknown";
}

export function networkProtocolVersionFromEdge(edge: EdgeProto): string {
  if (edge === "h3") return "3";
  if (edge === "h2") return "2";
  if (edge === "h1") return "1.1";
  return "unknown";
}

/**
 * Legacy name: same as {@link edgeProtoFromRequestHeaders} (edge-only, no hop fallback).
 * Prefer `edgeProtoFromRequestHeaders` for new code.
 */
export function inferNetProtoForSpan(req: Request): string {
  return edgeProtoFromRequestHeaders(req);
}

function pickIncomingHeader(req: IncomingMessage, name: string): string | undefined {
  const h = req.headers;
  const x = h[name.toLowerCase()];
  if (typeof x === "string") return x.split(",")[0]?.trim();
  if (Array.isArray(x) && x[0]) return String(x[0]).split(",")[0]?.trim();
  return undefined;
}

export function edgeProtoFromIncomingMessage(req: IncomingMessage): EdgeProto {
  const edge = normalizeEdgeProto(pickIncomingHeader(req, "x-och-edge-proto"));
  if (edge !== "unknown") return edge;
  return normalizeEdgeProto(pickIncomingHeader(req, "x-och-transport"));
}

export function upstreamProtoFromIncomingHop(req: IncomingMessage): UpstreamProto {
  const v = req.httpVersion;
  if (v === "2.0") return "h2";
  if (v === "1.1" || v === "1.0") return "h1";
  return "unknown";
}

export function inferNetProtoFromIncomingMessage(req: IncomingMessage): string {
  return edgeProtoFromIncomingMessage(req);
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

/** HTTP span: edge vs hop protocol + OTel semantic protocol attrs (edge drives user-facing SLOs). */
export function decorateHttpSpanWithTransport(span: Span, req: Request): void {
  const edge = edgeProtoFromRequestHeaders(req);
  const up = upstreamProtoFromExpressHop(req);
  span.setAttribute("och.edge_proto", edge);
  span.setAttribute("och.upstream_proto", up);
  span.setAttribute("network.protocol.name", "http");
  span.setAttribute("network.protocol.version", networkProtocolVersionFromEdge(edge));
  span.setAttribute("net.proto", edge);
  applyDebugReplayHeaderToSpan(span, req);
}

export function decorateIncomingMessageSpanWithTransport(span: Span, req: IncomingMessage): void {
  const edge = edgeProtoFromIncomingMessage(req);
  const up = upstreamProtoFromIncomingHop(req);
  span.setAttribute("och.edge_proto", edge);
  span.setAttribute("och.upstream_proto", up);
  span.setAttribute("network.protocol.name", "http");
  span.setAttribute("network.protocol.version", networkProtocolVersionFromEdge(edge));
  span.setAttribute("net.proto", edge);
  applyDebugReplayFromIncomingHeaders(span, req);
}
