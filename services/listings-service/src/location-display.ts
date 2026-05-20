/**
 * Human-readable listing locations for marketplace UI.
 * Lat/lng remain the source of truth for distance; never format raw coordinates for users.
 */

const NEIGHBORHOOD_LABELS = [
  "Near campus",
  "Downtown",
  "West End",
  "North Amherst",
  "East Hadley",
  "Pine Street area",
] as const;

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Plausible public line near default campus (UMass / Amherst); aligns with seeded geo. */
export function syntheticDisplayLocationFromLatLng(
  lat: number,
  lng: number,
  seed = "",
): string {
  const idx = hashSeed(seed || `${lat.toFixed(5)},${lng.toFixed(5)}`) % NEIGHBORHOOD_LABELS.length;
  return `${NEIGHBORHOOD_LABELS[idx]}, Amherst, MA`;
}

export function formatListingPublicLocation(row: Record<string, unknown>): string | null {
  const explicit = String(row.display_location ?? "").trim();
  if (explicit) return explicit.slice(0, 240);
  const city = String(row.city ?? "").trim();
  const st = String(row.state_or_province ?? "").trim();
  const nb = String(row.neighborhood ?? "").trim();
  if (city || st) {
    const parts = [nb, [city, st].filter(Boolean).join(", ")].filter(Boolean);
    return parts.join(" · ").slice(0, 240);
  }
  const lat =
    row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
  const lng =
    row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
  if (lat != null && lng != null) {
    return syntheticDisplayLocationFromLatLng(lat, lng, String(row.id ?? ""));
  }
  return null;
}

export const RESIDENCE_TYPES = [
  "apartment",
  "house",
  "townhouse",
  "condo",
  "studio",
  "room",
  "duplex",
  "other",
] as const;

export type ResidenceType = (typeof RESIDENCE_TYPES)[number];

function normalizeOptStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Returns canonical slug or null if invalid / empty. */
export function normalizeResidenceType(v: unknown): string | null {
  const s = normalizeOptStr(v).toLowerCase();
  if (!s) return null;
  return (RESIDENCE_TYPES as readonly string[]).includes(s) ? s : null;
}

/**
 * Prefer explicit display_location; else join structured address parts; else synthetic from geo.
 */
export function buildDisplayLocationForCreate(
  body: Record<string, unknown>,
  lat: number | null,
  lng: number | null,
  seed: string,
): string | null {
  const direct = normalizeOptStr(body.display_location);
  if (direct) return direct.slice(0, 240);
  const nb = normalizeOptStr(body.neighborhood);
  const city = normalizeOptStr(body.city);
  const st = normalizeOptStr(body.state_or_province ?? body.region ?? body.state);
  const line1 = normalizeOptStr(body.address_line1);
  const parts = [nb, city || st ? [city, st].filter(Boolean).join(", ") : "", line1].filter(Boolean);
  if (parts.length) return parts.join(" · ").slice(0, 240);
  if (lat != null && lng != null) return syntheticDisplayLocationFromLatLng(lat, lng, seed);
  return null;
}
