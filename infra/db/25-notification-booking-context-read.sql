-- Booking-context read helpers for notification.notifications.
-- Apply on database `notification` after 24-notification-read-state.sql:
--   psql … -d notification -v ON_ERROR_STOP=1 -f infra/db/25-notification-booking-context-read.sql

-- Fast unread booking lookups for mark-context-read by booking id.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_booking_ctx
  ON notification.notifications (
    user_id,
    (COALESCE(NULLIF(payload->>'bookingId', ''), NULLIF(payload->>'booking_id', '')))
  )
  WHERE read_at IS NULL
    AND (
      COALESCE(payload->>'bookingId', '') <> ''
      OR COALESCE(payload->>'booking_id', '') <> ''
    );

-- Fallback path when older payloads only carry a booking detail deep link.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_deeplink
  ON notification.notifications (
    user_id,
    (COALESCE(NULLIF(payload->>'deep_link', ''), NULLIF(payload->>'deepLink', '')))
  )
  WHERE read_at IS NULL
    AND (
      COALESCE(payload->>'deep_link', '') <> ''
      OR COALESCE(payload->>'deepLink', '') <> ''
    );
