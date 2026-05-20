/**
 * Canonical in-app user label: display_name if present, else username/handle, else fallback.
 * Avoid showing raw UUIDs as primary identity.
 */

/** Derive a non-email public handle from an email local-part (until true username is on every row). */
export function handleHintFromEmail(email: string | null | undefined): string {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return "";
  let local = e.split("@")[0] ?? "";
  local = local.replace(/\+[^@]*$/, "").trim();
  if (!local) return "";
  const safe = local.replace(/[^a-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return safe.slice(0, 48);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const GENERATED_USERNAME_SUFFIX_RE =
  /^(.+?)_(?:[0-9a-f]{8,32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/**
 * Hide auth/internal uniqueness suffixes like `tomwang04312_507ab69b2d` in user-facing labels.
 * Leaves ordinary underscore usernames intact.
 */
export function cleanUsernameForDisplay(username: string | null | undefined): string {
  let raw = String(username ?? "").trim().replace(/^@+/, "");
  if (!raw) return "";
  for (let i = 0; i < 4; i += 1) {
    const match = raw.match(GENERATED_USERNAME_SUFFIX_RE);
    if (!match?.[1]) break;
    raw = match[1];
  }
  return raw.slice(0, 64);
}

export function shortUuidLabel(id: string | null | undefined): string {
  const u = String(id ?? "").trim().toLowerCase();
  if (!UUID_RE.test(u)) return u ? u.slice(0, 12) : "";
  return `…${u.slice(0, 8)}`;
}

/**
 * Product order: username / handle → display name → email local-part → short id (never raw UUID, never “guest”).
 */
export function formatIdentityPriority(opts: {
  username?: string | null;
  display_name?: string | null;
  email?: string | null;
  id?: string | null;
}): string {
  const rawU = cleanUsernameForDisplay(opts.username);
  if (rawU) return `@${rawU.slice(0, 64)}`;
  const d = String(opts.display_name ?? "").trim();
  if (d) return d.slice(0, 120);
  const hint = handleHintFromEmail(opts.email);
  if (hint) return hint.slice(0, 120);
  const sid = shortUuidLabel(opts.id);
  if (sid) return sid;
  return "—";
}

export function formatUserDisplayName(
  displayName: string | null | undefined,
  username: string | null | undefined,
  fallback?: string,
): string {
  const d = String(displayName ?? "").trim();
  if (d) return d.slice(0, 120);
  const u = cleanUsernameForDisplay(username);
  if (u) return u.slice(0, 120);
  const hint = handleHintFromEmail(fallback);
  if (hint) return hint.slice(0, 120);
  const fb = String(fallback ?? "").trim();
  if (fb && !fb.includes("@")) return fb.slice(0, 120);
  return "Housing neighbor";
}

/** Username with @ prefix for chips / community headers. */
export function formatAtUsername(username: string | null | undefined): string {
  const u = cleanUsernameForDisplay(username);
  return u ? `@${u.slice(0, 64)}` : "";
}

/**
 * Renter-facing host line: display / @username / email local / short id.
 */
export function formatHostCounterpartyLine(opts: {
  landlord_display?: string | null;
  listing_landlord_display?: string | null;
  landlord_id?: string | null;
  landlord_email?: string | null;
}): string {
  const email = String(opts.landlord_email ?? "").trim().toLowerCase();
  if (EMAILISH.test(email)) return `Host: ${email}`;
  const line = formatIdentityPriority({
    username: null,
    display_name: String(opts.landlord_display ?? "").trim() || String(opts.listing_landlord_display ?? "").trim() || null,
    email: null,
    id: opts.landlord_id ?? null,
  });
  if (line === "—") return "";
  return `Host: ${line}`;
}

/** Legacy `renter_display` sometimes holds a handle, sometimes a full name (trust/email heuristics). */
function splitLegacyRenterDisplay(renter_display?: string | null): { username: string | null; display_name: string | null } {
  const raw = String(renter_display ?? "").trim().replace(/^@+/, "");
  if (!raw) return { username: null, display_name: null };
  if (raw.includes(" ") || raw.includes("@")) return { username: null, display_name: raw };
  return { username: cleanUsernameForDisplay(raw), display_name: null };
}

/**
 * Landlord-facing renter line: @username → display name → email local-part → short id.
 */
export function formatRenterCounterpartyLine(opts: {
  renter_username?: string | null;
  renter_display_name?: string | null;
  renter_display?: string | null;
  tenant_email?: string | null;
  tenant_id?: string | null;
}): string {
  const legacy = splitLegacyRenterDisplay(opts.renter_display);
  const u = cleanUsernameForDisplay(opts.renter_username) || legacy.username;
  const d = String(opts.renter_display_name ?? "").trim() || legacy.display_name;
  const line = formatIdentityPriority({
    username: u || null,
    display_name: d || null,
    email: opts.tenant_email ?? null,
    id: opts.tenant_id ?? null,
  });
  if (line === "—") return "";
  return `Renter: ${line}`;
}

/** Other party on a booking row for trust peer-review prefill / dropdowns. */
export function formatBookingCounterpartyHint(
  b: {
    tenant_id?: string | null;
    landlord_id?: string | null;
    renter_username?: string | null;
    renter_display_name?: string | null;
    renter_display?: string | null;
    landlord_display?: string | null;
    tenant_email?: string | null;
  },
  myUserId: string,
): string {
  const me = myUserId.trim().toLowerCase();
  const tenant = String(b.tenant_id ?? "").trim().toLowerCase();
  if (tenant === me) {
    const landlordEmail = String((b as { landlord_email?: string | null }).landlord_email ?? "").trim();
    if (EMAILISH.test(landlordEmail)) return landlordEmail;
    return formatIdentityPriority({
      username: null,
      display_name: b.landlord_display ?? null,
      email: null,
      id: b.landlord_id ?? null,
    });
  }
  const legacy = splitLegacyRenterDisplay(b.renter_display);
  const u = cleanUsernameForDisplay(b.renter_username) || legacy.username;
  const d = String(b.renter_display_name ?? "").trim() || legacy.display_name;
  return formatIdentityPriority({
    username: u || null,
    display_name: d || null,
    email: b.tenant_email ?? null,
    id: b.tenant_id ?? null,
  });
}
