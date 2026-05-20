/** Shared SQL builder for HTTP GET search and gRPC SearchListings (keep filters in sync). */

import { RESIDENCE_TYPES } from "./location-display.js";

const SEARCH_SORTS = new Set([
  "created_desc",
  "newest",
  "listed_desc",
  "price_asc",
  "price_desc",
  "distance_asc",
  /** SQL uses created_at ordering; listings HTTP post-sorts by watch + reputation. */
  "marketplace_rank",
]);

export function parseAmenitySlugs(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[a-z0-9_-]+$/i.test(s)),
    ),
  ];
}

/** Comma-separated residence slugs (must match DB check constraint). */
export function parseResidenceTypesCsv(raw: string): string[] {
  const allowed = new Set(RESIDENCE_TYPES as unknown as string[]);
  return [
    ...new Set(
      raw
        .split(/[,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => allowed.has(s)),
    ),
  ];
}

export type ListingsSearchFilters = {
  q?: string;
  minP?: number | null;
  maxP?: number | null;
  smoke?: boolean;
  pets?: boolean;
  furnished?: boolean;
  amenitySlugs?: string[];
  newWithin?: number | null;
  sort?: string;
  limit?: number | null;
  offset?: number | null;
  page?: number | null;
  pageSize?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  availableFrom?: string | null;
  minLeaseMonths?: number | null;
  campusLat?: number | null;
  campusLng?: number | null;
  /** Optional geo filter: listings within `radiusMiles` of this point (requires lat+lng+radius). */
  searchCenterLat?: number | null;
  searchCenterLng?: number | null;
  radiusMiles?: number | null;
  /** Within N miles of campus (uses campusLat/campusLng defaults). */
  campusWithinMiles?: number | null;
  residenceTypes?: string[];
  minSqft?: number | null;
  maxSqft?: number | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
};

export function buildListingsSearchQuery(filters: ListingsSearchFilters): {
  sql: string;
  params: unknown[];
} {
  const q = (filters.q ?? "").trim();
  const minP = filters.minP ?? null;
  const maxP = filters.maxP ?? null;
  const smoke = Boolean(filters.smoke);
  const pets = Boolean(filters.pets);
  const furnished = Boolean(filters.furnished);
  const amenitySlugs = [...new Set(filters.amenitySlugs ?? [])];
  const newWithin = filters.newWithin ?? null;
  const bedrooms = filters.bedrooms ?? null;
  const bathrooms = filters.bathrooms ?? null;
  const availableFrom = (filters.availableFrom ?? "").trim() || null;
  const minLeaseMonths = filters.minLeaseMonths ?? null;
  const campusLat =
    typeof filters.campusLat === "number" && Number.isFinite(filters.campusLat)
      ? filters.campusLat
      : 42.3868;
  const campusLng =
    typeof filters.campusLng === "number" && Number.isFinite(filters.campusLng)
      ? filters.campusLng
      : -72.5301;
  const searchCenterLat = filters.searchCenterLat ?? null;
  const searchCenterLng = filters.searchCenterLng ?? null;
  const radiusMilesRaw = filters.radiusMiles ?? null;
  const hasRadiusFilter =
    typeof searchCenterLat === "number" &&
    Number.isFinite(searchCenterLat) &&
    typeof searchCenterLng === "number" &&
    Number.isFinite(searchCenterLng) &&
    typeof radiusMilesRaw === "number" &&
    Number.isFinite(radiusMilesRaw) &&
    radiusMilesRaw > 0 &&
    radiusMilesRaw <= 200;
  const campusWithinRaw = filters.campusWithinMiles ?? null;
  const hasCampusWithin =
    typeof campusWithinRaw === "number" &&
    Number.isFinite(campusWithinRaw) &&
    campusWithinRaw > 0 &&
    campusWithinRaw <= 50;
  const residenceTypes = [...new Set(filters.residenceTypes ?? [])].filter((t) =>
    (RESIDENCE_TYPES as readonly string[]).includes(t),
  );
  const minSqft = filters.minSqft ?? null;
  const maxSqft = filters.maxSqft ?? null;
  const cityQ = (filters.city ?? "").trim();
  const stateQ = (filters.state ?? "").trim();
  const neighborhoodQ = (filters.neighborhood ?? "").trim();

  const sortRaw = (filters.sort ?? "created_desc").trim();
  const sort = SEARCH_SORTS.has(sortRaw) ? sortRaw : "created_desc";

  const MAX_LIMIT = 240;
  const limitRaw = filters.limit ?? filters.pageSize ?? 50;
  const pageRaw = filters.page ?? null;
  const pageOffset =
    typeof pageRaw === "number" &&
    Number.isFinite(pageRaw) &&
    pageRaw > 0
      ? (Math.floor(pageRaw) - 1) *
        (typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
          : 50)
      : null;
  const offsetRaw = filters.offset ?? pageOffset ?? 0;

  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : 50;

  const offset =
    typeof offsetRaw === "number" &&
    Number.isFinite(offsetRaw) &&
    offsetRaw >= 0
      ? Math.floor(offsetRaw)
      : 0;

  /** Whitelisted integer token bound as a parameter (CASE arms); never interpolate raw sort strings. */
  let sortKey = 3;
  if (sort === "price_asc") sortKey = 1;
  else if (sort === "price_desc") sortKey = 2;
  else if (sort === "listed_desc") sortKey = 4;
  else if (sort === "distance_asc") sortKey = 5;
  else if (sort === "newest" || sort === "created_desc" || sort === "marketplace_rank") sortKey = 3;

  const params: unknown[] = [];
  let i = 1;
  const where: string[] = [
    `status::text = 'active'`,
    `(deleted_at IS NULL)`,
    `(listings.listings.soft_hold_until IS NULL OR listings.listings.soft_hold_until <= now())`,
    `EXISTS (SELECT 1 FROM listings.listing_media lm WHERE lm.listing_id = listings.listings.id AND lm.media_type = 'image' LIMIT 1)`,
  ];
  const qIsUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      q,
    );
  if (q) {
    if (qIsUuid) {
      where.push(`(id = $${i}::uuid OR title ILIKE $${i + 1} OR description ILIKE $${i + 1})`);
      params.push(q);
      params.push(`%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
      i += 2;
    } else {
      where.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
      params.push(`%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
      i++;
    }
  }
  if (minP != null && !Number.isNaN(minP)) {
    where.push(`price_cents >= $${i}`);
    params.push(minP);
    i++;
  }
  if (maxP != null && !Number.isNaN(maxP)) {
    where.push(`price_cents <= $${i}`);
    params.push(maxP);
    i++;
  }
  if (smoke) where.push(`smoke_free = true`);
  if (pets) where.push(`pet_friendly = true`);
  if (furnished) where.push(`furnished IS TRUE`);
  for (const slug of amenitySlugs) {
    where.push(`amenities::jsonb @> $${i}::jsonb`);
    params.push(JSON.stringify([slug]));
    i++;
  }
  if (newWithin != null) {
    where.push(`created_at >= NOW() - ($${i}::int * INTERVAL '1 day')`);
    params.push(newWithin);
    i++;
  }
  if (bedrooms != null && Number.isFinite(bedrooms) && bedrooms > 0) {
    const b = Math.floor(bedrooms);
    where.push(
      `((listings.listings.bedrooms IS NOT NULL AND listings.listings.bedrooms >= $${i}) OR (listings.listings.bedrooms IS NULL AND (title ILIKE $${i + 1} OR description ILIKE $${i + 1} OR title ILIKE $${i + 2} OR description ILIKE $${i + 2})))`,
    );
    params.push(b);
    params.push(`%${b} bed%`);
    params.push(`%${b}br%`);
    i += 3;
  }
  if (bathrooms != null && Number.isFinite(bathrooms) && bathrooms > 0) {
    const b = bathrooms;
    where.push(
      `((listings.listings.bathrooms IS NOT NULL AND listings.listings.bathrooms >= $${i}::numeric) OR (listings.listings.bathrooms IS NULL AND (title ILIKE $${i + 1} OR description ILIKE $${i + 1} OR title ILIKE $${i + 2} OR description ILIKE $${i + 2})))`,
    );
    params.push(b);
    params.push(`%${Math.floor(b)} bath%`);
    params.push(`%${Math.floor(b)}ba%`);
    i += 3;
  }
  if (availableFrom != null && /^\d{4}-\d{2}-\d{2}$/.test(availableFrom)) {
    where.push(`effective_from <= $${i}::date`);
    params.push(availableFrom);
    i++;
  }
  if (minLeaseMonths != null && Number.isFinite(minLeaseMonths) && minLeaseMonths > 0) {
    where.push(`lease_length_months IS NOT NULL AND lease_length_months >= $${i}::int`);
    params.push(Math.floor(minLeaseMonths));
    i++;
  }
  if (minSqft != null && Number.isFinite(minSqft) && minSqft > 0) {
    where.push(`listings.listings.size_sqft IS NOT NULL AND listings.listings.size_sqft >= $${i}::int`);
    params.push(Math.floor(minSqft));
    i++;
  }
  if (maxSqft != null && Number.isFinite(maxSqft) && maxSqft > 0) {
    where.push(`listings.listings.size_sqft IS NOT NULL AND listings.listings.size_sqft <= $${i}::int`);
    params.push(Math.floor(maxSqft));
    i++;
  }
  if (residenceTypes.length) {
    where.push(`listings.listings.residence_type = ANY($${i}::text[])`);
    params.push(residenceTypes);
    i++;
  }
  if (cityQ) {
    where.push(`lower(coalesce(listings.listings.city, '')) ILIKE lower($${i})`);
    params.push(`%${cityQ.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
    i++;
  }
  if (stateQ) {
    where.push(`lower(coalesce(listings.listings.state_or_province, '')) ILIKE lower($${i})`);
    params.push(`%${stateQ.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
    i++;
  }
  if (neighborhoodQ) {
    where.push(
      `(lower(coalesce(listings.listings.neighborhood, '')) ILIKE lower($${i}) OR lower(coalesce(listings.listings.display_location, '')) ILIKE lower($${i}))`,
    );
    params.push(`%${neighborhoodQ.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
    i++;
  }
  if (hasRadiusFilter) {
    where.push(`listings.listings.latitude IS NOT NULL AND listings.listings.longitude IS NOT NULL`);
    where.push(
      `(3959.0 * acos(LEAST(1.0::double precision, GREATEST(-1.0::double precision,
        cos(radians($${i}::double precision)) * cos(radians(listings.listings.latitude::double precision))
        * cos(radians(listings.listings.longitude::double precision) - radians($${i + 1}::double precision))
        + sin(radians($${i}::double precision)) * sin(radians(listings.listings.latitude::double precision))
      )))) <= $${i + 2}::double precision`,
    );
    params.push(searchCenterLat, searchCenterLng, radiusMilesRaw);
    i += 3;
  }
  if (hasCampusWithin) {
    where.push(`listings.listings.latitude IS NOT NULL AND listings.listings.longitude IS NOT NULL`);
    where.push(
      `(3959.0 * acos(LEAST(1.0::double precision, GREATEST(-1.0::double precision,
        cos(radians($${i}::double precision)) * cos(radians(listings.listings.latitude::double precision))
        * cos(radians(listings.listings.longitude::double precision) - radians($${i + 1}::double precision))
        + sin(radians($${i}::double precision)) * sin(radians(listings.listings.latitude::double precision))
      )))) <= $${i + 2}::double precision`,
    );
    params.push(campusLat, campusLng, campusWithinRaw);
    i += 3;
  }

  const sortParamIndex = i;
  params.push(sortKey);

  const innerSelect = `
        SELECT listings.listings.id,
               listings.listings.user_id,
               listings.listings.username_display,
               listings.listings.title,
               listings.listings.description,
               listings.listings.price_cents,
               listings.listings.amenities,
               listings.listings.smoke_free,
               listings.listings.pet_friendly,
               listings.listings.furnished,
               listings.listings.status::text AS status,
               listings.listings.created_at,
               listings.listings.updated_at,
               listings.listings.listed_at,
               listings.listings.latitude,
               listings.listings.longitude,
               listings.listings.display_location,
               listings.listings.effective_from,
               listings.listings.effective_until,
               listings.listings.lease_length_months,
               listings.listings.size_sqft,
               listings.listings.residence_type,
               listings.listings.city,
               listings.listings.state_or_province,
               listings.listings.country,
               listings.listings.neighborhood,
               listings.listings.bedrooms,
               listings.listings.bathrooms,
               COALESCE(listings.listings.pricing_mode::text, 'fixed') AS pricing_mode,
               listings.listings.soft_hold_until,
               (
                 SELECT m.url_or_path
                 FROM listings.listing_media m
                 WHERE m.listing_id = listings.listings.id AND m.media_type = 'image'
                 ORDER BY m.sort_order ASC, m.created_at ASC
                 LIMIT 1
               ) AS primary_image_url
        FROM listings.listings
        WHERE ${where.join(" AND ")}
      `;

  const sql = `
        WITH filtered AS (
          ${innerSelect}
        )
        SELECT *,
               COUNT(*) OVER() AS total_count
        FROM filtered
        ORDER BY
          CASE WHEN $${sortParamIndex}::int = 1 THEN price_cents END ASC NULLS LAST,
          CASE WHEN $${sortParamIndex}::int = 2 THEN price_cents END DESC NULLS LAST,
          CASE WHEN $${sortParamIndex}::int = 4 THEN listed_at END DESC NULLS LAST,
          CASE WHEN $${sortParamIndex}::int = 5 THEN (
            pow(coalesce(latitude, ${campusLat}) - ${campusLat}, 2) +
            pow(coalesce(longitude, ${campusLng}) - ${campusLng}, 2)
          ) END ASC NULLS LAST,
          CASE WHEN $${sortParamIndex}::int = 3 THEN created_at END DESC NULLS LAST,
          created_at DESC,
          id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
  return { sql, params };
}
