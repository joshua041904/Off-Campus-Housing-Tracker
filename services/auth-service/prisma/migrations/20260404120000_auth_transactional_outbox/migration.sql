-- Transactional outbox for reliable Kafka delivery (user.account.deleted.v1, etc.)
CREATE TABLE IF NOT EXISTS auth.auth_outbox (
    id UUID PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    retry_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_outbox_unpublished
ON auth.auth_outbox (created_at ASC)
WHERE published_at IS NULL;

COMMENT ON TABLE auth.auth_outbox IS 'Transactional outbox: INSERT in same txn as domain write; background worker publishes to Kafka and sets published_at.';
