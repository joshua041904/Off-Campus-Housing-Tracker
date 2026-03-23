-- trust DB (5446)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, listing_id, reporter_id, status, created_at
FROM trust.listing_flags
ORDER BY created_at DESC
LIMIT 50;
