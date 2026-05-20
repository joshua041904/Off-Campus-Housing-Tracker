/**
 * Optional: resolve landlord @handle from trust-service (auth read replica) for listing UX
 * when `listings.listings.username_display` is empty (legacy rows).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function fetchLandlordHandleFromTrust(landlordUserId: string): Promise<string | null> {
  const id = String(landlordUserId || "").trim();
  if (!UUID_RE.test(id)) return null;
  const base = (
    process.env.LISTINGS_TRUST_HTTP_URL ||
    process.env.TRUST_SERVICE_HTTP_URL ||
    "http://127.0.0.1:4016"
  ).replace(/\/$/, "");
  const url = `${base}/public/users/resolve?q=${encodeURIComponent(id)}`;
  try {
    const ms = Number(process.env.LISTINGS_TRUST_RESOLVE_TIMEOUT_MS ?? "2500");
    const timeout = Number.isFinite(ms) ? Math.min(10_000, Math.max(200, ms)) : 2500;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!upstream.ok) return null;
    const j = (await upstream.json()) as { matches?: Array<{ username?: string | null; display_name?: string | null }> };
    const m = j.matches?.[0];
    const u = String(m?.username ?? m?.display_name ?? "").trim();
    return u ? u.slice(0, 120) : null;
  } catch {
    return null;
  }
}
