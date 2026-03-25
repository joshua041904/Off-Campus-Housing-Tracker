-- Tail latency (Issue 9): default public search uses
--   WHERE status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50
-- (see services/listings-service/src/search-listings-query.ts).
-- Existing composites cover price/effective/smoke_pet but not this global recency sort.

CREATE INDEX IF NOT EXISTS idx_listings_active_created_desc
  ON listings.listings (created_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
