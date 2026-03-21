-- Watchlist funnel + messaging engagement projections (run after 03-analytics-recommendation.sql).
-- PGPASSWORD=postgres psql -h 127.0.0.1 -p 5447 -U postgres -d analytics -f infra/db/04-analytics-watchlist-engagement.sql

CREATE TABLE IF NOT EXISTS analytics.user_watchlist_daily (
  user_id UUID NOT NULL,
  day DATE NOT NULL,
  adds INTEGER NOT NULL DEFAULT 0,
  removes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

COMMENT ON TABLE analytics.user_watchlist_daily IS
  'Projected watchlist adds/removes per user per day (from booking/listing domain events).';

CREATE TABLE IF NOT EXISTS analytics.user_listing_engagement (
  user_id UUID NOT NULL,
  listing_id UUID NOT NULL,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, listing_id)
);

COMMENT ON TABLE analytics.user_listing_engagement IS
  'Conversation/listing messaging counts for renter–landlord analytics (consumer stub).';

CREATE TABLE IF NOT EXISTS analytics.listing_feel_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'renter',
  model TEXT NOT NULL,
  analysis_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_feel_cache_hash_audience
  ON analytics.listing_feel_cache (content_hash, audience);

COMMENT ON TABLE analytics.listing_feel_cache IS
  'Short-lived cache for Ollama listing “feel” analysis (thundering herd mitigation).';
