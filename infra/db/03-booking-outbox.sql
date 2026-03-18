-- Transactional outbox for booking-service. Run after 02-booking-state-machine.sql.
-- Flow: write domain change + insert outbox row in same transaction; commit; background worker publishes to Kafka; mark published.
-- Contract: payload = serialized proto bytes (not JSON). envelope.event_id = outbox.id. Kafka key = aggregate_id. See docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md.

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

COMMENT ON COLUMN booking.outbox_events.payload IS 'Serialized domain event (proto bytes), e.g. BookingCreatedV1; not JSON.';
COMMENT ON COLUMN booking.outbox_events.id IS 'UUID = envelope.event_id; publisher must set envelope.event_id = this id (no new UUID on publish).';
COMMENT ON TABLE booking.outbox_events IS 'Transactional outbox: same transaction as domain write; background publisher sends EventEnvelope; Kafka key = aggregate_id.';
