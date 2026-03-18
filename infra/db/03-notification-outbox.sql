-- Transactional outbox for notification-service (optional emit: NotificationSentV1). Run after 02-notification-idempotency.sql.
-- Flow: after delivery, insert outbox row; background worker publishes to Kafka; mark published.

CREATE TABLE IF NOT EXISTS notification.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_unpublished
  ON notification.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN notification.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN notification.outbox_events.id IS 'UUID = envelope.event_id; publisher must set envelope.event_id = this id (no new UUID on publish).';
COMMENT ON TABLE notification.outbox_events IS 'Transactional outbox for optional NotificationSentV1 emit; background publisher sends EventEnvelope; Kafka key = aggregate_id.';
