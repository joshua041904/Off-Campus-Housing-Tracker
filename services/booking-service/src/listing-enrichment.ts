/**
 * Fetch compact listing cards from listings-service for moderation / fraud UIs.
 * 60s in-memory cache per listing id (booking-service process lifetime).
 */
const TTL_MS = 60_000;

const INTEGRATION_NOISE =
  /\b(seed(ed|ing)?|integration|fixture|RICH-LISTING-MARKER|FV\s+listing|batch)\b/i;

/** Row shape from GET /bookings/mine after listing enrichment. */
export function isIntegrationBookingRow(row: {
  listing_title?: unknown;
  listing?: unknown;
}): boolean {
  const direct = row.listing_title;
  if (typeof direct === "string") return isIntegrationBookingTitle(direct);
  const listing = row.listing;
  if (listing && typeof listing === "object") {
    return isIntegrationBookingTitle(listing as { title?: string | null });
  }
  return false;
}

/** Hide Cursor/Payload integration bookings from tenant dashboards. */
export function isIntegrationBookingTitle(
  raw: string | { title?: string | null } | null | undefined,
): boolean {
  const s =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? String((raw as { title?: string | null }).title ?? "")
        : "";
  const t = s.trim();
  if (!t) return false;
  if (/^cursor\s+proof\b/i.test(t) || /^payload\s+check\b/i.test(t) || /^clean\s+check\b/i.test(t)) {
    return true;
  }
  return INTEGRATION_NOISE.test(t);
}

/** Match webapp prettyListingTitle so booking rows stay human-readable when enrichment fails. */
function scrubSnapshotTitle(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Listing";
  if (/\bseeded\b/i.test(s) && /\d{10,}/.test(s)) {
    const beds = s.match(/^(\d+)\s*bed/i)?.[1];
    return beds ? `${beds}-bed near campus` : "Campus listing";
  }
  if (/^och-page-\d+-/i.test(s)) return "Listing";
  if (INTEGRATION_NOISE.test(s)) {
    const beds = s.match(/^(\d+)\s*bed/i)?.[1];
    if (beds) return `${beds}-bed near campus`;
    if (/premium\s+furnished/i.test(s)) return "Furnished rental near campus";
    return "Campus listing";
  }
  return s.replace(/\b\d{10,}\b\s*$/u, "").trim() || "Listing";
}

const cache = new Map<string, { expiresAt: number; value: ListingCardJson | null }>();

export type ListingCardJson = {
  id: string;
  title: string;
  price_usd_monthly: number | null;
  location: string | null;
  primary_image_url: string | null;
  /** Host-facing label from listings.username_display / trust backfill (internal listing only). */
  landlord_display?: string | null;
};

export function listingCardFromBookingSnapshot(input: {
  listingId: string;
  title: string | null | undefined;
  priceCentsSnapshot: number | null | undefined;
}): ListingCardJson {
  const cents = Number(input.priceCentsSnapshot);
  const price = Number.isFinite(cents) ? Math.round(cents) / 100 : null;
  const title = scrubSnapshotTitle(input.title);
  return {
    id: input.listingId,
    title,
    price_usd_monthly: price,
    location: null,
    primary_image_url: null,
    landlord_display: null,
  };
}

export async function getListingCardCached(listingId: string): Promise<ListingCardJson | null> {
  const now = Date.now();
  const hit = cache.get(listingId);
  if (hit && hit.expiresAt > now) return hit.value;

  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  const base = (process.env.LISTINGS_HTTP || "http://127.0.0.1:4012").replace(/\/$/, "");
  if (!secret) {
    cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
    return null;
  }

  const url = `${base}/internal/listings/${encodeURIComponent(listingId)}`;
  let res: globalThis.Response;
  try {
    const ms = Number(process.env.BOOKING_LISTING_ENRICH_TIMEOUT_MS ?? "8000");
    const t = Number.isFinite(ms) ? Math.min(30_000, Math.max(500, ms)) : 8000;
    res = await fetch(url, {
      headers: { "x-booking-internal-secret": secret },
      signal: AbortSignal.timeout(t),
    });
  } catch {
    cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
    return null;
  }

  if (res.status === 404) {
    cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
    return null;
  }
  if (!res.ok) {
    cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
    return null;
  }

  let j: Record<string, unknown>;
  try {
    j = (await res.json()) as Record<string, unknown>;
  } catch {
    cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
    return null;
  }

  const priceUsd =
    j.price_usd_monthly != null && Number.isFinite(Number(j.price_usd_monthly))
      ? Number(j.price_usd_monthly)
      : j.price != null && Number.isFinite(Number(j.price))
        ? Number(j.price)
        : null;
  const primaryUrl =
    j.primary_image_url != null
      ? String(j.primary_image_url)
      : j.primaryImageUrl != null
        ? String(j.primaryImageUrl)
        : null;

  const card: ListingCardJson = {
    id: String(j.id ?? listingId),
    title: String(j.title ?? "Listing").trim() || "Listing",
    price_usd_monthly: priceUsd,
    location: j.location != null ? String(j.location) : null,
    primary_image_url: primaryUrl,
    landlord_display:
      j.landlord_display != null && String(j.landlord_display).trim()
        ? String(j.landlord_display).trim().slice(0, 120)
        : j.host_display != null && String(j.host_display).trim()
          ? String(j.host_display).trim().slice(0, 120)
          : null,
  };

  cache.set(listingId, { expiresAt: now + TTL_MS, value: card });
  return card;
}

export async function resolveListingCard(
  listingId: string,
  snapshot: { title: string | null | undefined; priceCentsSnapshot: number | null | undefined },
): Promise<ListingCardJson> {
  const enriched = await getListingCardCached(listingId);
  if (enriched) return enriched;
  return listingCardFromBookingSnapshot({
    listingId,
    title: snapshot.title,
    priceCentsSnapshot: snapshot.priceCentsSnapshot,
  });
}
