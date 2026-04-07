/** Shared SQL builder for HTTP GET search and gRPC SearchListings (keep filters in sync). */

const SEARCH_SORTS = new Set([
  "created_desc",
  "listed_desc",
  "price_asc",
  "price_desc",
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
  const sortRaw = (filters.sort ?? "created_desc").trim();
  const sort = SEARCH_SORTS.has(sortRaw) ? sortRaw : "created_desc";

  // Pagination parsing with defaults and guards against invalid input (negative, non-integer, non-finite, etc).
  const MAX_LIMIT = 100;
  const limitRaw = filters.limit ?? 50;
  const offsetRaw = filters.offset ?? 0;

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

  const params: unknown[] = [];
  let i = 1;
  const where: string[] = [`status::text = 'active'`, `(deleted_at IS NULL)`];
  if (q) {
    where.push(`(title ILIKE $${i} OR description ILIKE $${i})`);
    params.push(`%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
    i++;
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

  // Add id as a final tie-breaker so repeated searches return a stable order.
  let orderBy = "created_at DESC, id ASC";
  if (sort === "listed_desc")
    orderBy = "listed_at DESC NULLS LAST, created_at DESC, id ASC";
  else if (sort === "price_asc")
    orderBy = "price_cents ASC NULLS LAST, created_at DESC, id ASC";
  else if (sort === "price_desc")
    orderBy = "price_cents DESC NULLS LAST, created_at DESC, id ASC";

  const sql = `
        SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished,
               status::text AS status, created_at, listed_at, latitude, longitude
        FROM listings.listings
        WHERE ${where.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT ${limit}
        OFFSET ${offset}
      `;
  return { sql, params };
}
