/**
 * When the user did not pass an explicit occupancy range, but did pass `availableFrom`
 * (move-in / lease-start filter), use that calendar day as the booking-overlap probe so
 * marketplace exclusion matches the same intent as the SQL `effective_from` filter.
 */
export function occupancyForReservedFromSearchParams(
  occupancyOverlap: { start: string; end: string } | null,
  availableFrom: string | null,
): { start: string; end: string } | null {
  if (occupancyOverlap) return occupancyOverlap;
  const d = (availableFrom ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return { start: d, end: d };
  return null;
}

/** UTC calendar day YYYY-MM-DD (aligned with booking-service date-only overlap). */
export function defaultSearchOccupancyUtcDay(): { start: string; end: string } {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const iso = `${y}-${m}-${day}`;
  return { start: iso, end: iso };
}

/**
 * Listing IDs with an overlapping active booking in the occupancy window (booking-service internal API).
 */
export async function fetchReservedSearchListingIds(
  listingIds: string[],
  occupancy: { start: string; end: string } | null,
): Promise<Set<string>> {
  const secret = (
    process.env.BOOKING_LISTINGS_INTERNAL_SECRET ||
    process.env.LISTINGS_BOOKING_INTERNAL_SECRET ||
    ""
  ).trim();
  const base = (process.env.BOOKING_HTTP || "http://127.0.0.1:4013").replace(/\/$/, "");
  if (!secret || listingIds.length === 0) return new Set();
  const overlap = occupancy ?? defaultSearchOccupancyUtcDay();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base}/internal/reserved-search-listing-ids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-booking-internal-secret": secret,
        },
        body: JSON.stringify({
          listing_ids: listingIds,
          overlap_start_date: overlap.start,
          overlap_end_date: overlap.end,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const j = (await res.json()) as { reserved_listing_ids?: string[] };
        return new Set(Array.isArray(j.reserved_listing_ids) ? j.reserved_listing_ids : []);
      }
      const snippet = await res.text().catch(() => "");
      console.warn(
        `[listings] reserved-search-listing-ids failed status=${res.status} body=${snippet.slice(0, 240)}`,
      );
      const retry = res.status >= 500 && attempt === 0;
      if (!retry) return new Set();
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      console.warn("[listings] reserved-search-listing-ids request error", e);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      return new Set();
    }
  }
  return new Set();
}
