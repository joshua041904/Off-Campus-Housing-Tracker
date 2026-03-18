-- Notification: idempotent consumer — deduplicate by event_id from Kafka envelope.
-- Run after 01-notification-schema.sql against database 'notification' on port 5445.

CREATE TABLE IF NOT EXISTS notification.processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification.processed_events IS 'Idempotent consumer: check event_id before processing; insert after successful handle; then commit offset.';
