-- Canonical dedupe for notification.notifications (Kafka + HTTP safety-net).
-- Apply on database `notification` after 25-notification-booking-context-read.sql:
--   PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:5445/notification?connect_timeout=10" \
--     -v ON_ERROR_STOP=1 -f infra/db/26-notification-dedupe-key.sql

ALTER TABLE notification.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

COMMENT ON COLUMN notification.notifications.dedupe_key IS
  'Stable key: recipient:event:context:status-bucket. Unique when set; used for UPSERT across Kafka/HTTP.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
  ON notification.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
