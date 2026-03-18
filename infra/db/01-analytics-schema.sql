-- Analytics service DB: immutable event log + precomputed aggregates. Consumer-only: no source-of-truth writes to other services.
-- Run against database 'analytics' on port 5447:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5447 -U postgres -d analytics -f infra/db/01-analytics-schema.sql
--
-- Analytics: consumes all domain events → appends to events → projects into daily_metrics / user_activity.
-- Does NOT serve transactional queries, modify other services, or block any flows. Store payload as JSONB; schema evolves.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS analytics;

-- 1) Raw event log — immutable. Never update; delete only per retention policy.
CREATE TABLE IF NOT EXISTS analytics.events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  event_version   INTEGER NOT NULL DEFAULT 1,
  payload         JSONB NOT NULL,
  source_service  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analytics.events IS 'Immutable event log. Ground truth for analytics. Project into aggregates; do not normalize event schema.';
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics.events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics.events(created_at);

-- 2) Daily metrics — precomputed aggregates, updated on event consumption
CREATE TABLE IF NOT EXISTS analytics.daily_metrics (
  date                    DATE PRIMARY KEY,
  new_users               INTEGER NOT NULL DEFAULT 0,
  new_listings            INTEGER NOT NULL DEFAULT 0,
  new_bookings            INTEGER NOT NULL DEFAULT 0,
  completed_bookings      INTEGER NOT NULL DEFAULT 0,
  messages_sent           INTEGER NOT NULL DEFAULT 0,
  listings_flagged         INTEGER NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analytics.daily_metrics IS 'Precomputed daily aggregates. Updated when consuming domain events.';

-- 3) Per-user activity (optional) — for dashboards and user-level metrics
CREATE TABLE IF NOT EXISTS analytics.user_activity (
  user_id           UUID PRIMARY KEY,
  listings_created  INTEGER NOT NULL DEFAULT 0,
  bookings_made     INTEGER NOT NULL DEFAULT 0,
  messages_sent     INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analytics.user_activity IS 'Per-user activity counters. Updated on event consumption.';

-- updated_at triggers for mutable aggregate tables
CREATE OR REPLACE FUNCTION analytics.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_daily_metrics_updated ON analytics.daily_metrics;
CREATE TRIGGER tr_daily_metrics_updated
  BEFORE UPDATE ON analytics.daily_metrics
  FOR EACH ROW EXECUTE PROCEDURE analytics.set_updated_at();

DROP TRIGGER IF EXISTS tr_user_activity_updated ON analytics.user_activity;
CREATE TRIGGER tr_user_activity_updated
  BEFORE UPDATE ON analytics.user_activity
  FOR EACH ROW EXECUTE PROCEDURE analytics.set_updated_at();
