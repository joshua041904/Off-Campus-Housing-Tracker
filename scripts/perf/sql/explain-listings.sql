-- listings DB (5442) — browse vs ILIKE search (see docs/perf/LISTINGS_SEARCH.md)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active' AND (deleted_at IS NULL)
ORDER BY created_at DESC
LIMIT 50;

-- Plan-only (no ANALYZE): ILIKE + OR would execute a heavy scan; ANALYZE can take minutes on large data.
EXPLAIN (VERBOSE, BUFFERS)
SELECT id, user_id, title, description, price_cents, amenities, smoke_free, pet_friendly, furnished, status::text AS status, created_at
FROM listings.listings
WHERE status::text = 'active' AND (deleted_at IS NULL)
  AND (title ILIKE '%explain-probe%' OR description ILIKE '%explain-probe%')
ORDER BY created_at DESC
LIMIT 50;
