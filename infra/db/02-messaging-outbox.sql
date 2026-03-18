-- Transactional outbox for messaging-service. Run after 01-messaging-schema.sql.
-- Flow: write domain change + insert outbox row in same transaction; commit; background worker publishes to Kafka; mark published.

CREATE TABLE IF NOT EXISTS messaging.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_messaging_outbox_unpublished
  ON messaging.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON TABLE messaging.outbox_events IS 'Transactional outbox: same transaction as domain write; background publisher sends EventEnvelope to dev.messaging.events; then sets published=true.';
