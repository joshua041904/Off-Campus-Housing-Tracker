-- Listings service: idempotent consumer — deduplicate by event_id from Kafka envelope.
-- Listings consumes dev.trust.events (e.g. listing.flagged). Run after 03-listings-outbox.sql.

CREATE TABLE IF NOT EXISTS listings.processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE listings.processed_events IS 'Idempotent consumer: before handling event, INSERT event_id; ON CONFLICT DO NOTHING skip; else process then commit offset. Kafka is at-least-once.';
