-- Trust service: idempotent consumer — deduplicate by event_id from Kafka envelope.
-- Trust consumes dev.booking.events (e.g. booking.completed for reviews). Run after 03-trust-outbox.sql.

CREATE TABLE IF NOT EXISTS trust.processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.processed_events IS 'Idempotent consumer: before handling event, INSERT event_id; ON CONFLICT DO NOTHING skip; else process then commit offset. Kafka is at-least-once.';
