-- Sync read_at across all booking-context rows per user+booking (idempotent).
-- Apply on database `notification`:
--   PGPASSWORD=postgres psql -h localhost -p 5445 -U postgres -d notification \
--     -v ON_ERROR_STOP=1 -f infra/db/30-notification-booking-read-siblings.sql

WITH booking_rows AS (
  SELECT
    n.id,
    n.user_id,
    LOWER(COALESCE(
      NULLIF(n.payload->>'context_id', ''),
      NULLIF(n.payload->>'bookingId', ''),
      NULLIF(n.payload->>'booking_id', ''),
      NULLIF(substring(COALESCE(n.payload->>'deep_link', n.payload->>'deepLink', '') from '/bookings/([0-9a-fA-F-]{36})'), '')
    )) AS booking_ctx,
    n.read_at
  FROM notification.notifications n
  WHERE COALESCE(n.payload->>'category', '') = 'booking'
     OR COALESCE(n.payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
     OR n.event_type LIKE 'booking.%'
),
grouped AS (
  SELECT
    id,
    BOOL_OR(read_at IS NOT NULL) OVER (PARTITION BY user_id, booking_ctx) AS any_read_in_booking
  FROM booking_rows
  WHERE booking_ctx ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
UPDATE notification.notifications n
SET read_at = COALESCE(n.read_at, now())
FROM grouped g
WHERE n.id = g.id
  AND g.any_read_in_booking
  AND n.read_at IS NULL;
