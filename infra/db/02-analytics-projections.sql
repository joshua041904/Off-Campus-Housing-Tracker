-- Analytics: projection state, versioning, and event_id for replay-safe idempotency.
-- Run after 01-analytics-schema.sql against database 'analytics' on port 5447.
-- Supports: replay from beginning, projection versioning, idempotent consumption by event_id.

-- 1) event_id on events — unique, required; use for dedup and replay (producer supplies in envelope)
ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS event_id UUID;
-- Backfill: use id as event_id for existing rows (new inserts from consumer must set event_id from envelope)
UPDATE analytics.events SET event_id = id WHERE event_id IS NULL;
ALTER TABLE analytics.events ALTER COLUMN event_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_event_id ON analytics.events(event_id);
COMMENT ON COLUMN analytics.events.event_id IS 'Unique event id from envelope; used for idempotent consumption and replay.';

-- 2) Idempotent consumption — analytics deduplicates by event_id before applying
CREATE TABLE IF NOT EXISTS analytics.processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE analytics.processed_events IS 'Idempotent consumer: only process if event_id not present; then insert and commit offset.';

-- 3) Projection state — last processed event per projection for resume/replay
CREATE TABLE IF NOT EXISTS analytics.projection_state (
  projection_name TEXT PRIMARY KEY,
  last_processed_event_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE analytics.projection_state IS 'Per-projection cursor; enables reset and replay from last_processed_event_id or from beginning.';

-- 4) Projection versioning — when projection logic changes, bump version and replay
CREATE TABLE IF NOT EXISTS analytics.projection_versions (
  name TEXT PRIMARY KEY,
  version INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE analytics.projection_versions IS 'Projection schema version; increment on logic change, then replay from beginning and update version.';
