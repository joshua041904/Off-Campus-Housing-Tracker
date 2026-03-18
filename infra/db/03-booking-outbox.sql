-- Transactional outbox for booking-service. Run after 02-booking-state-machine.sql.
-- Flow: write domain change + insert outbox row in same transaction; commit; background worker publishes to Kafka; mark published.

CREATE TABLE IF NOT EXISTS booking.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_booking_outbox_unpublished
  ON booking.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON TABLE booking.outbox_events IS 'Transactional outbox: same transaction as domain write; background publisher sends EventEnvelope to dev.booking.events; then sets published=true.';
