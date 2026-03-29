import type { Request } from "express";

/** Strip query string for path matching (same as server gatewayPathOnly). */
export function gatewayPathOnly(req: Request): string {
  return (req.originalUrl || req.url || "").split("?")[0];
}

/** Never queue or charge cluster weight for probes, metrics, or CORS preflight. */
export function skipsGatewayTrafficControls(req: Request): boolean {
  if (req.method === "OPTIONS") return true;
  const p = gatewayPathOnly(req);
  if (p === "/healthz" || p === "/api/healthz") return true;
  if (p === "/readyz" || p === "/api/readyz") return true;
  if (p === "/metrics") return true;
  if (p === "/whoami") return true;
  if (req.method === "GET" && /\/healthz\/?$/.test(p)) return true;
  return false;
}
