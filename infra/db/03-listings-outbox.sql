-- Transactional outbox for listings-service. Run after 02-listings-pgbench-trigram-knn.sql (or after 01 if no 02).
-- Flow: write domain change + insert outbox row in same transaction; commit; background worker publishes to Kafka; mark published.

CREATE TABLE IF NOT EXISTS listings.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_listings_outbox_unpublished
  ON listings.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN listings.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN listings.outbox_events.id IS 'UUID = envelope.event_id; publisher must set envelope.event_id = this id (no new UUID on publish).';
COMMENT ON TABLE listings.outbox_events IS 'Transactional outbox: same transaction as domain write; background publisher sends EventEnvelope; Kafka key = aggregate_id.';
