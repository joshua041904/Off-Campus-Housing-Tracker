/**
 * Optional forward geocoding (Nominatim). Disabled unless LISTINGS_GEOCODE_ENABLED=1.
 * Rate-limited in production — set a descriptive User-Agent per Nominatim policy.
 */

export type GeocodeInput = {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_or_province: string;
  postal_code?: string | null;
  country: string;
};

export async function geocodeStructuredAddress(
  input: GeocodeInput,
): Promise<{ lat: number; lng: number } | null> {
  const enabled = process.env.LISTINGS_GEOCODE_ENABLED === "1" || process.env.LISTINGS_GEOCODE_ENABLED === "true";
  if (!enabled) return null;
  const q = [
    input.address_line1,
    input.address_line2,
    input.city,
    input.state_or_province,
    input.postal_code,
    input.country,
  ]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  if (!q || q.length < 8) return null;
  const ua =
    process.env.LISTINGS_GEOCODE_USER_AGENT ||
    "OffCampusHousingTracker/listings-service (contact: dev@localhost)";
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", q);
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": ua, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = data?.[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
