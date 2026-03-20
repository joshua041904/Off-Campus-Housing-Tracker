/**
 * API base for the housing api-gateway.
 * - If NEXT_PUBLIC_API_BASE is set: browser calls that origin (e.g. https://off-campus-housing.local).
 * - If unset: use same-origin `/api/...` and rely on next.config.mjs rewrites to API_GATEWAY_INTERNAL (default http://127.0.0.1:4020).
 */
export function getApiBase(): string {
  const b = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "");
  return b ?? "";
}
