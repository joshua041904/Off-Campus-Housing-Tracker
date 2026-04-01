CREATE TABLE IF NOT EXISTS booking.processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE booking.processed_events IS 'Kafka consumer idempotency (user.lifecycle.v1 etc.); INSERT event_id ON CONFLICT DO NOTHING before handle.';
