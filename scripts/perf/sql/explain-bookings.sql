-- bookings DB (5443)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, listing_id, tenant_id, landlord_id, status, created_at
FROM booking.bookings
ORDER BY created_at DESC
LIMIT 50;
