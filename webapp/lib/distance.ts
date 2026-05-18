/** Default campus reference (UMass Amherst area — adjust per deployment via env later). */
export const DEFAULT_CAMPUS_LAT = 42.3868;
export const DEFAULT_CAMPUS_LNG = -72.5301;

const EARTH_RADIUS_MI = 3958.8;
const MAX_REASONABLE_MI = 200;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Haversine distance in miles; undefined if inputs are not valid finite coordinates. */
export function milesBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number | undefined {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return undefined;
  }
  if (Math.abs(lat1) < 0.0005 && Math.abs(lng1) < 0.0005) return undefined;
  if (Math.abs(lat2) < 0.0005 && Math.abs(lng2) < 0.0005) return undefined;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const miles = EARTH_RADIUS_MI * c;
  if (!Number.isFinite(miles) || miles < 0 || miles > MAX_REASONABLE_MI) return undefined;
  return miles;
}

/** Distance from listing coords to campus; undefined when unavailable (UI: "Distance unavailable"). */
export function distanceToCampusMiles(
  listingLat?: number | null,
  listingLng?: number | null,
  campusLat = DEFAULT_CAMPUS_LAT,
  campusLng = DEFAULT_CAMPUS_LNG,
): number | undefined {
  if (listingLat == null || listingLng == null) return undefined;
  return milesBetween(campusLat, campusLng, Number(listingLat), Number(listingLng));
}
