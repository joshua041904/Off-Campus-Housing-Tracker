/** Cached GET /internal/listings/:id for richer landlord notification payloads (not Kafka schema). */
const TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: ListingSnippet | null }>();

export type ListingSnippet = {
  title: string;
  price_usd_monthly: number | null;
  location: string | null;
  primary_image_url: string | null;
};

export async function fetchListingSnippetCached(listingId: string): Promise<ListingSnippet | null> {
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
  try {
    const res = await fetch(url, {
      headers: { "x-booking-internal-secret": secret },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
      return null;
    }
    const j = (await res.json()) as Record<string, unknown>;
    const snippet: ListingSnippet = {
      title: String(j.title ?? "Listing").trim() || "Listing",
      price_usd_monthly:
        j.price_usd_monthly != null && Number.isFinite(Number(j.price_usd_monthly))
          ? Number(j.price_usd_monthly)
          : null,
      location: j.location != null ? String(j.location) : null,
      primary_image_url:
        j.primary_image_url != null
          ? String(j.primary_image_url)
          : j.primaryImageUrl != null
            ? String(j.primaryImageUrl)
            : null,
    };
    cache.set(listingId, { expiresAt: now + TTL_MS, value: snippet });
    return snippet;
  } catch {
    cache.set(listingId, { expiresAt: now + TTL_MS, value: null });
    return null;
  }
}
