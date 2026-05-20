import { cleanUsernameForDisplay, formatIdentityPriority, handleHintFromEmail } from "./user-display";

const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(v: string): boolean {
  return UUID_SHAPE_RE.test(String(v || "").trim());
}

/** Identity fields copied across booking-context notification rows during merge/backfill. */
export const BOOKING_IDENTITY_PAYLOAD_KEYS = [
  "renter_username",
  "tenant_username_snapshot",
  "tenant_username",
  "tenantUsername",
  "tenantUsernameSnapshot",
  "renter_display_name",
  "tenant_display_name",
  "tenantDisplayName",
  "renter_display",
  "renterDisplay",
  "tenant_email",
  "tenantEmail",
] as const;

export function extractBookingIdentityFields(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BOOKING_IDENTITY_PAYLOAD_KEYS) {
    const v = p[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    out[k] = v;
  }
  return out;
}

/** True when payload has a non-UUID handle, display name, or email local-part. */
export function payloadHasGoodBookingIdentity(p: Record<string, unknown>): boolean {
  const handle = String(
    p.renter_username ??
      p.tenant_username_snapshot ??
      p.tenant_username ??
      p.tenantUsernameSnapshot ??
      p.tenantUsername ??
      "",
  )
    .trim()
    .replace(/^@+/, "");
  if (handle && !isUuidLike(handle) && /^[a-z0-9_.-]{3,}$/i.test(handle)) return true;
  const display = String(p.renter_display_name ?? p.tenant_display_name ?? p.tenantDisplayName ?? "").trim();
  if (display && !isUuidLike(display)) return true;
  const email = String(p.tenant_email ?? p.tenantEmail ?? "").trim();
  if (email.includes("@")) return true;
  if (handleHintFromEmail(email)) return true;
  return false;
}

/** Merge identity from source into target (target lifecycle/status fields win). */
export function mergeIdentityIntoPayload(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...target };
  const identity = extractBookingIdentityFields(source);
  for (const [k, v] of Object.entries(identity)) {
    const cur = merged[k];
    const curS = cur != null ? String(cur).trim() : "";
    if (!curS || (isUuidLike(curS) && !isUuidLike(String(v)))) {
      merged[k] = v;
    }
    if (!curS && v != null) merged[k] = v;
  }
  if (!payloadHasGoodBookingIdentity(merged) && payloadHasGoodBookingIdentity(source)) {
    Object.assign(merged, identity);
  } else if (payloadHasGoodBookingIdentity(source) && !payloadHasGoodBookingIdentity(merged)) {
    Object.assign(merged, identity);
  }
  return merged;
}

/**
 * Landlord/renter display label — strict product order:
 * renter_username → tenant_username_snapshot → renter_display_name → email local-part → short id.
 */
export function renterLabelFromBookingPayload(p: Record<string, unknown>): string {
  const renterUsername = cleanUsernameForDisplay(
    String(p.renter_username ?? "").trim() || null,
  );
  const snapshot = cleanUsernameForDisplay(
    String(
      p.tenant_username_snapshot ??
        p.tenantUsernameSnapshot ??
        p.tenant_username ??
        p.tenantUsername ??
        "",
    ).trim() || null,
  );
  const handle = renterUsername || snapshot;
  if (handle) return `@${handle}`;

  const display = String(
    p.renter_display_name ?? p.tenant_display_name ?? p.tenantDisplayName ?? p.renter_display ?? "",
  ).trim();
  if (display && !isUuidLike(display)) return display.slice(0, 120);

  const email = String(p.tenant_email ?? p.tenantEmail ?? "").trim();
  const hint = handleHintFromEmail(email);
  if (hint) return hint.slice(0, 120);

  const tenantId = String(p.renter_id ?? p.renterId ?? p.tenant_id ?? p.tenantId ?? "").trim();
  if (tenantId && isUuidLike(tenantId)) return `…${tenantId.replace(/-/g, "").slice(0, 8)}`;

  return formatIdentityPriority({
    username: null,
    display_name: null,
    email: email || null,
    id: tenantId || null,
  });
}
