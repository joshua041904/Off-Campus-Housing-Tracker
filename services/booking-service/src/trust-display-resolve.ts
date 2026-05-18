/**
 * Resolve tenant display labels via trust-service public user lookup (auth DB read behind trust).
 * Used when booking rows lack tenant_email snapshot so dashboards do not fall back to raw UUIDs.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * When `TRUST_HTTP` is omitted from ConfigMap (cluster drift), infer trust base from
 * `BOOKING_HTTP` so renter enrichment (`/bookings/mine`, landlord dashboards) still resolves usernames.
 */
function inferTrustHttpFromBookingHttp(): string {
  const raw = (process.env.BOOKING_HTTP || "").trim();
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(withProto.replace(/\/$/, ""));
    if (!/booking-service/i.test(u.hostname)) return "";
    u.hostname = u.hostname.replace(/booking-service/i, "trust-service");
    if (u.port === "4013" || u.port === "") u.port = "4016";
    return u.origin;
  } catch {
    return "";
  }
}

function trustHttpBase(): string {
  const explicit = (process.env.TRUST_HTTP || "").replace(/\/$/, "").trim();
  if (explicit) return explicit;
  return inferTrustHttpFromBookingHttp();
}

export type TrustPublicIdentity = {
  username: string | null;
  display_name: string | null;
  email: string | null;
};

export async function trustPublicIdentityForUserId(userId: string): Promise<TrustPublicIdentity | null> {
  const id = String(userId || "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return null;
  const base = trustHttpBase();
  if (!base) return null;
  const url = `${base}/public/users/resolve?q=${encodeURIComponent(id)}`;
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      data?: {
        matches?: Array<{
          username?: string | null;
          display_name?: string | null;
          email?: string | null;
        }>;
      };
    };
    const m = j.data?.matches?.[0];
    if (!m) return null;
    const username = String(m.username ?? "")
      .trim()
      .replace(/^@+/, "");
    const display_name = String(m.display_name ?? "").trim();
    const email = String(m.email ?? "").trim().toLowerCase();
    const u = username || null;
    const d = display_name || null;
    const e = email.includes("@") ? email : null;
    if (!u && !d && !e) return null;
    return { username: u, display_name: d, email: e };
  } catch {
    return null;
  }
}

/** Prefer username, then display_name (trust public resolve). */
export async function trustPublicLabelForUserId(userId: string): Promise<string | null> {
  const ident = await trustPublicIdentityForUserId(userId);
  if (!ident) return null;
  return ident.username || ident.display_name || null;
}

/** Parallel resolve: tenantId(lower) → structured identity for `formatIdentityPriority`. */
export async function trustPublicIdentitiesForUserIds(userIds: string[]): Promise<Map<string, TrustPublicIdentity>> {
  const out = new Map<string, TrustPublicIdentity>();
  const uniq = [...new Set(userIds.map((x) => String(x || "").trim().toLowerCase()).filter((x) => UUID_RE.test(x)))];
  if (!uniq.length) return out;
  await Promise.all(
    uniq.map(async (id) => {
      const ident = await trustPublicIdentityForUserId(id);
      if (ident) out.set(id, ident);
    }),
  );
  return out;
}

/** Parallel resolve for unique tenant ids; returns map tenantId(lower) -> single display string (compat). */
export async function trustPublicLabelsForUserIds(userIds: string[]): Promise<Map<string, string>> {
  const idents = await trustPublicIdentitiesForUserIds(userIds);
  const out = new Map<string, string>();
  for (const [k, v] of idents) {
    const s = v.username || v.display_name || "";
    if (s) out.set(k, s);
  }
  return out;
}
