-- Transactional outbox for auth-service. Run against database 'auth' (e.g. port 5441).
-- Auth DB may be restored from dump; this script is idempotent. Flow: domain change + insert outbox in same transaction; background publisher to dev.auth.events.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_auth_outbox_unpublished
  ON auth.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON TABLE auth.outbox_events IS 'Transactional outbox: same transaction as domain write; background publisher sends EventEnvelope to dev.auth.events; then sets published=true.';
