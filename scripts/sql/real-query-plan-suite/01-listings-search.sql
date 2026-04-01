-- Listings DB (5442): typical price-sorted search with soft-delete + effective window.
-- Expect: btree on (status, price_cents, ...) or partial indexes per infra/db tuning.
\set ON_ERROR_STOP on
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, price_cents, title, listed_at
FROM listings.listings
WHERE status = 'active'::listings.listing_status
  AND deleted_at IS NULL
  AND price_cents BETWEEN 50000 AND 400000
  AND effective_from <= CURRENT_DATE
  AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
ORDER BY price_cents ASC
LIMIT 20;
