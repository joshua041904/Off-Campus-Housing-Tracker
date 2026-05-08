/**
 * Strip invisible chars and common copy/paste mistakes (e.g. https:\/\/host) that break Chrome DNS.
 */
function sanitizePublicOrigin(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "");
  // Zero-width and bidi marks sometimes sneak into env vars / docs
  s = s.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  // NBSP / narrow NBSP / ideographic space — Chrome may show ERR_ADDRESS_UNREACHABLE if the host is "poisoned".
  s = s.replace(/[\u00A0\u202F\u3000]/g, "");
  // Copy/paste from JSON sometimes leaves literal backslashes before slashes (Chrome then fails DNS).
  s = s.replace(/^https?:\\+\/+/i, (m) => (m.toLowerCase().startsWith("https") ? "https://" : "http://"));
  // Single missing slash after scheme: "https:/host"
  s = s.replace(/^https:\/(?!\/)/i, "https://").replace(/^http:\/(?!\/)/i, "http://");
  // Stray `\` inside hostname (e.g. https://off\-campus… from over-escaped env) — Safari tolerates more than Chromium.
  s = s.replace(/^(https?:\/\/)([^/?#]+)/i, (_m, scheme: string, hostport: string) => {
    if (hostport.startsWith("[")) return `${scheme}${hostport}`;
    return `${scheme}${hostport.replace(/\\/g, "")}`;
  });
  return s.replace(/\/+$/, "");
}

/**
 * API base for the housing api-gateway.
 * - If NEXT_PUBLIC_API_BASE is set: browser calls that origin (e.g. https://off-campus-housing.test).
 * - If unset: use same-origin `/api/...` and `next.config.mjs` rewrites to API_GATEWAY_INTERNAL (default http://127.0.0.1:4020).
 *   Bare `/insights/...` is rewritten the same way so service-relative analytics paths never hit the Next.js router.
 */
export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE;
  if (!raw) return "";
  return sanitizePublicOrigin(raw);
}
