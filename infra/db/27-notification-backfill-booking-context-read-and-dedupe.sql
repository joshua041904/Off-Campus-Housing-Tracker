-- Booking notification context_id / dedupe_key backfill (idempotent; does not delete rows).
-- Apply on database `notification`:
--   PGPASSWORD=postgres psql -h localhost -p 5445 -U postgres -d notification \
--     -v ON_ERROR_STOP=1 -f infra/db/27-notification-backfill-booking-context-read-and-dedupe.sql

-- 1) Backfill payload.context_id from booking id / deep_link when missing.
UPDATE notification.notifications n
SET payload = jsonb_set(
  payload,
  '{context_id}',
  to_jsonb(
    LOWER(
      COALESCE(
        NULLIF(payload->>'bookingId', ''),
        NULLIF(payload->>'booking_id', ''),
        NULLIF(substring(COALESCE(payload->>'deep_link', payload->>'deepLink', payload->>'href', '') from '/bookings/([0-9a-fA-F-]{36})'), '')
      )
    )
  ),
  true
)
WHERE (
    COALESCE(payload->>'category', '') = 'booking'
    OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
    OR event_type LIKE 'booking.%'
  )
  AND COALESCE(NULLIF(payload->>'context_id', ''), '') = ''
  AND COALESCE(
    NULLIF(payload->>'bookingId', ''),
    NULLIF(payload->>'booking_id', ''),
    NULLIF(substring(COALESCE(payload->>'deep_link', payload->>'deepLink', payload->>'href', '') from '/bookings/([0-9a-fA-F-]{36})'), ''),
    ''
  ) <> '';

-- 2) Backfill dedupe_key for booking rows when missing (matches app collapse key shape).
UPDATE notification.notifications n
SET dedupe_key = CONCAT(
  'booking:',
  LOWER(user_id::text),
  ':',
  LOWER(COALESCE(NULLIF(payload->>'context_id', ''), NULLIF(payload->>'bookingId', ''), NULLIF(payload->>'booking_id', ''))),
  ':',
  LOWER(COALESCE(NULLIF(payload->>'booking_status', ''), NULLIF(payload->>'new_status', ''), event_type))
)
WHERE dedupe_key IS NULL
  AND (
    COALESCE(payload->>'category', '') = 'booking'
    OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
    OR event_type LIKE 'booking.%'
  )
  AND COALESCE(NULLIF(payload->>'context_id', ''), NULLIF(payload->>'bookingId', ''), NULLIF(payload->>'booking_id', ''), '') <> '';

-- 3) Same user + booking context + event_type + booking_status: if any row is read, mark all duplicates read.
WITH booking_rows AS (
  SELECT
    id,
    user_id,
    event_type,
    LOWER(COALESCE(NULLIF(payload->>'context_id', ''), NULLIF(payload->>'bookingId', ''), NULLIF(payload->>'booking_id', ''))) AS booking_ctx,
    UPPER(COALESCE(NULLIF(payload->>'booking_status', ''), NULLIF(payload->>'new_status', ''), '')) AS booking_status,
    read_at
  FROM notification.notifications
  WHERE COALESCE(payload->>'category', '') = 'booking'
     OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
     OR event_type LIKE 'booking.%'
),
grouped AS (
  SELECT
    id,
    user_id,
    BOOL_OR(read_at IS NOT NULL) OVER (
      PARTITION BY user_id, booking_ctx, event_type, booking_status
    ) AS any_read_in_group
  FROM booking_rows
  WHERE booking_ctx ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
UPDATE notification.notifications n
SET read_at = COALESCE(n.read_at, now())
FROM grouped g
WHERE n.id = g.id
  AND g.any_read_in_group
  AND n.read_at IS NULL;

-- 4) Same user + booking context (any event): if any row is read, mark remaining unread rows for that booking read.
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
