/**
 * Fire-and-forget: booking-service matches saved searches and inserts notifications.
 */
export function fireSavedSearchNotifyForNewListing(payload: {
  listing_id: string;
  landlord_user_id: string;
  title: string;
  price_cents: number;
  residence_type?: string | null;
  size_sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: string | null;
}): void {
  const base = (process.env.BOOKING_HTTP || "").replace(/\/$/, "");
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  if (!base || !secret) return;
  void fetch(`${base}/internal/new-listing-saved-search-notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-booking-internal-secret": secret,
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    /* best-effort */
  });
}
