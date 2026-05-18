-- Booking notification read-state normalization (idempotent).
-- Apply on database `notification`:
--   PGPASSWORD=postgres psql -h localhost -p 5445 -U postgres -d notification \
--     -v ON_ERROR_STOP=1 -f infra/db/30-notification-booking-read-state-normalize.sql

-- 1) Backfill payload.context_id from strongest booking identity sources.
UPDATE notification.notifications n
SET payload = jsonb_set(
  COALESCE(n.payload, '{}'::jsonb),
  '{context_id}',
  to_jsonb(
    LOWER(COALESCE(
      CASE WHEN COALESCE(n.payload->>'category', '') = 'booking' THEN NULLIF(n.payload->>'context_id', '') END,
      NULLIF(n.payload->>'context_id', ''),
      NULLIF(n.payload->>'booking_id', ''),
      NULLIF(n.payload->>'bookingId', ''),
      NULLIF(substring(
        COALESCE(
          n.payload->>'deep_link',
          n.payload->>'deepLink',
          n.payload->>'href',
          n.payload->>'action_url',
          n.payload->>'actionUrl',
          ''
        ) from '/bookings/([0-9a-fA-F-]{36})'
      ), '')
    ))
  ),
  true
)
WHERE (
  COALESCE(n.payload->>'category', '') = 'booking'
  OR COALESCE(n.payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
  OR n.event_type LIKE 'booking.%'
)
AND COALESCE(NULLIF(n.payload->>'context_id', ''), '') = ''
AND LOWER(COALESCE(
  NULLIF(n.payload->>'booking_id', ''),
  NULLIF(n.payload->>'bookingId', ''),
  NULLIF(substring(
    COALESCE(
      n.payload->>'deep_link',
      n.payload->>'deepLink',
      n.payload->>'href',
      n.payload->>'action_url',
      n.payload->>'actionUrl',
      ''
    ) from '/bookings/([0-9a-fA-F-]{36})'
  ), '')
)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 2) Canonical dedupe_key for booking lifecycle rows.
UPDATE notification.notifications n
SET dedupe_key = 'notification:booking:' || n.user_id::text || ':' ||
  LOWER(COALESCE(
    NULLIF(n.payload->>'context_id', ''),
    NULLIF(n.payload->>'booking_id', ''),
    NULLIF(n.payload->>'bookingId', '')
  )) || ':' || COALESCE(NULLIF(n.event_type, ''), 'booking.event')
WHERE (
  COALESCE(n.payload->>'category', '') = 'booking'
  OR COALESCE(n.payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
  OR n.event_type LIKE 'booking.%'
)
AND LOWER(COALESCE(
  NULLIF(n.payload->>'context_id', ''),
  NULLIF(n.payload->>'booking_id', ''),
  NULLIF(n.payload->>'bookingId', '')
)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
AND COALESCE(n.event_type, '') <> ''
AND (
  n.dedupe_key IS NULL
  OR n.dedupe_key NOT LIKE 'notification:booking:%'
);

-- 3) Propagate read_at across user + booking context (earliest read wins).
WITH booking_rows AS (
  SELECT
    n.id,
    n.user_id,
    LOWER(COALESCE(
      NULLIF(n.payload->>'context_id', ''),
      NULLIF(n.payload->>'booking_id', ''),
      NULLIF(n.payload->>'bookingId', ''),
      NULLIF(substring(
        COALESCE(
          n.payload->>'deep_link',
          n.payload->>'deepLink',
          n.payload->>'href',
          n.payload->>'action_url',
          n.payload->>'actionUrl',
          ''
        ) from '/bookings/([0-9a-fA-F-]{36})'
      ), '')
    )) AS booking_ctx,
    n.read_at
  FROM notification.notifications n
  WHERE COALESCE(n.payload->>'category', '') = 'booking'
     OR COALESCE(n.payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
     OR n.event_type LIKE 'booking.%'
),
ctx AS (
  SELECT user_id, booking_ctx, MIN(read_at) AS context_read_at
  FROM booking_rows
  WHERE booking_ctx ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY user_id, booking_ctx
  HAVING BOOL_OR(read_at IS NOT NULL)
)
UPDATE notification.notifications n
SET read_at = COALESCE(n.read_at, c.context_read_at)
FROM booking_rows br
JOIN ctx c ON br.user_id = c.user_id AND br.booking_ctx = c.booking_ctx
WHERE n.id = br.id
  AND n.read_at IS NULL
  AND c.context_read_at IS NOT NULL;

-- 4) Remove exact duplicate lifecycle rows (same user, booking, event_type, channel).
WITH ranked AS (
  SELECT
    n.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        n.user_id,
        LOWER(COALESCE(
          NULLIF(n.payload->>'context_id', ''),
          NULLIF(n.payload->>'booking_id', ''),
          NULLIF(n.payload->>'bookingId', '')
        )),
        n.event_type,
        n.channel
      ORDER BY n.read_at NULLS LAST, n.created_at DESC, n.id DESC
    ) AS rn
  FROM notification.notifications n
  WHERE n.event_type LIKE 'booking.%'
    AND LOWER(COALESCE(
      NULLIF(n.payload->>'context_id', ''),
      NULLIF(n.payload->>'booking_id', ''),
      NULLIF(n.payload->>'bookingId', '')
    )) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
DELETE FROM notification.notifications n
USING ranked r
WHERE n.id = r.id
  AND r.rn > 1;
