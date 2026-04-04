-- Bookings DB (5443): GiST exclusion / range overlap probe (realistic conflict check).
\set ON_ERROR_STOP on
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, status, start_date, end_date
FROM booking.bookings
WHERE listing_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND daterange(start_date, end_date, '[]') && daterange('2026-05-01', '2026-05-10', '[]')
  AND status IN ('confirmed', 'pending_confirmation');
