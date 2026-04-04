-- Idempotency for Kafka consumers (user.lifecycle.v1). Apply to database messaging (port 5444).
CREATE TABLE IF NOT EXISTS messaging.processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE messaging.processed_events IS 'Kafka consumer idempotency; see docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md';
