-- Remove test/accidental duplicate booking notifications and sync read state (idempotent).
-- Apply on database `notification`:
--   PGPASSWORD=postgres psql -h localhost -p 5445 -U postgres -d notification \
--     -v ON_ERROR_STOP=1 -f infra/db/29-notification-booking-dedupe-cleanup.sql

-- 1) Mark all rows in a booking context read when any sibling for that user+booking is read.
WITH booking_rows AS (
  SELECT
    id,
    user_id,
    LOWER(COALESCE(NULLIF(payload->>'context_id', ''), NULLIF(payload->>'bookingId', ''), NULLIF(payload->>'booking_id', ''))) AS booking_ctx,
    read_at
  FROM notification.notifications
  WHERE COALESCE(payload->>'category', '') = 'booking'
     OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
     OR event_type LIKE 'booking.%'
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

-- 2) Delete obvious duplicate test rows (same booking, :dup dedupe_key suffix) when canonical exists.
DELETE FROM notification.notifications n
WHERE n.dedupe_key LIKE '%:dup'
  AND EXISTS (
    SELECT 1
    FROM notification.notifications c
    WHERE c.user_id = n.user_id
      AND c.id <> n.id
      AND LOWER(COALESCE(c.payload->>'context_id', c.payload->>'booking_id', '')) =
          LOWER(COALESCE(n.payload->>'context_id', n.payload->>'booking_id', ''))
      AND c.dedupe_key IS NOT NULL
      AND c.dedupe_key NOT LIKE '%:dup'
  );
