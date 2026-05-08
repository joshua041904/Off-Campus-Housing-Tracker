-- Analytics semantic + hybrid search index (pgvector + BM25/tsvector).
-- Run against analytics DB after 03-analytics-recommendation.sql.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS analytics.listing_search_index (
  listing_id   UUID PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  embedding    vector(384) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_tsv   tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED
);

COMMENT ON TABLE analytics.listing_search_index IS
  'Hybrid search corpus for analytics recommendations. Embedding (pgvector) + full-text (tsvector).';

-- Vector ANN index (cosine). Requires enough rows before planner prefers it.
CREATE INDEX IF NOT EXISTS idx_listing_search_embedding_ivfflat
  ON analytics.listing_search_index
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_listing_search_tsv
  ON analytics.listing_search_index
  USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS idx_listing_search_created_at
  ON analytics.listing_search_index (created_at DESC);
