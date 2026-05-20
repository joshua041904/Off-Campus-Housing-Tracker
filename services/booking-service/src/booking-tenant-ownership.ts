/**
 * Tenant ownership for bookings: same auth user id OR shared username base (duplicate accounts).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const GENERATED_USERNAME_SUFFIX_RE =
  /^(.+?)_(?:[0-9a-f]{8,32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/** Strip auth/internal uniqueness suffixes so sibling accounts share one booking identity. */
export function cleanUsernameIdentityBase(username: string | null | undefined): string {
  let raw = String(username ?? "").trim().replace(/^@+/, "");
  if (!raw) return "";
  for (let i = 0; i < 4; i += 1) {
    const match = raw.match(GENERATED_USERNAME_SUFFIX_RE);
    if (!match?.[1]) break;
    raw = match[1];
  }
  return raw.slice(0, 64);
}

export type BookingTenantIdentityRow = {
  tenantId: string;
  tenantUsernameSnapshot?: string | null;
};

export function tenantOwnsBooking(
  booking: BookingTenantIdentityRow,
  userId: string,
  identityUsername?: string | null,
): boolean {
  const uid = String(userId || "").trim().toLowerCase();
  if (!UUID_RE.test(uid)) return false;
  if (String(booking.tenantId || "").trim().toLowerCase() === uid) return true;
  const base = cleanUsernameIdentityBase(identityUsername);
  if (!base || base.length < 3) return false;
  const snap = cleanUsernameIdentityBase(booking.tenantUsernameSnapshot);
  if (!snap) return false;
  return snap === base || snap.startsWith(`${base}_`);
}
