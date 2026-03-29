"use client";

/**
 * Google Maps Embed API (Places). Restrict key by HTTP referrer in Google Cloud Console.
 * @see https://developers.google.com/maps/documentation/embed/get-started
 */
const DEFAULT_CAMPUS = "University of Massachusetts Amherst";

type Props = {
  /** Free-text place query when lat/lng not set */
  placeQuery?: string;
  latitude?: number | null;
  longitude?: number | null;
  zoom?: number;
  height?: number;
  className?: string;
};

export function GoogleMapEmbed({
  placeQuery,
  latitude,
  longitude,
  zoom = 14,
  height = 220,
  className = "",
}: Props) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return (
      <p
        data-testid="map-embed-placeholder"
        className={`text-xs text-slate-600 ${className}`}
      >
        Add <code className="rounded bg-slate-200 px-1 text-slate-800">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
        to show a map (Embed API enabled). Coordinates are still saved on the listing for when the key is set.
      </p>
    );
  }
  const qParam =
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
      ? `${latitude},${longitude}`
      : encodeURIComponent(placeQuery?.trim() || DEFAULT_CAMPUS);
  const src = `https://www.google.com/maps/embed/v1/place?key=${key}&q=${qParam}&zoom=${zoom}`;
  return (
    <iframe
      title="Map preview"
      data-testid="map-embed-iframe"
      className={`w-full rounded-lg border border-slate-300 ${className}`}
      style={{ height }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
      src={src}
    />
  );
}
