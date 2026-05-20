-- User read state for in-app notification rows (separate from delivery status).
-- Apply on database `notification` after 01-notification-schema.sql:
--   psql … -d notification -v ON_ERROR_STOP=1 -f infra/db/24-notification-read-state.sql

ALTER TABLE notification.notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

COMMENT ON COLUMN notification.notifications.read_at IS 'When the recipient opened/dismissed the notification in-app; NULL = unread for badge.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notification.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Legacy rows used delivery `status` for “inbox”; once `read_at` exists, treat non-pending as already seen
-- so the new badge (read_at IS NULL) does not explode for historical data.
UPDATE notification.notifications
SET read_at = COALESCE(read_at, now())
WHERE read_at IS NULL
  AND status::text IN ('sent', 'failed', 'retrying');
