-- Listings: trigram + KNN-style search and optional vector/HNSW for pgbench.
-- Run after 01-listings-schema-and-tuning.sql. Requires pg_trgm and search_norm on listings.listings.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/02-listings-pgbench-trigram-knn.sql
--
-- Trigram: fuzzy text search on title/description (search_norm).
-- KNN: same search_norm + similarity() ordering (trigram KNN). For true vector ANN, enable the optional vector section below.

SET client_min_messages TO NOTICE;

-- Backfill search_norm for existing rows (trigger only runs on INSERT/UPDATE)
UPDATE listings.listings
SET search_norm = lower(trim(coalesce(title, '') || ' ' || coalesce(description, '')))
WHERE search_norm IS NULL;

-- Normalizer for query text (align with search_norm format)
CREATE OR REPLACE FUNCTION listings.norm_text(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT lower(trim(regexp_replace(coalesce(trim(t), ''), '\s+', ' ', 'g')));
$$;

-- Fuzzy search: returns count of matching listing ids (for pgbench). Uses trigram similarity on search_norm.
-- Optional: set pg_trgm.similarity_threshold (e.g. 0.3) via session or ALTER DATABASE.
CREATE OR REPLACE FUNCTION listings.search_listings_fuzzy_ids(
  p_user_id uuid,
  p_q text,
  p_lim integer DEFAULT 50
)
RETURNS TABLE(listing_id uuid)
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  qn text;
BEGIN
  qn := listings.norm_text(coalesce(p_q, ''));
  IF qn = '' THEN
    RETURN QUERY SELECT l.id FROM listings.listings l
      WHERE l.user_id = p_user_id AND l.status = 'active' AND l.deleted_at IS NULL
      ORDER BY l.created_at DESC LIMIT p_lim;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT l.id
  FROM listings.listings l
  WHERE l.user_id = p_user_id
    AND l.status = 'active'
    AND l.deleted_at IS NULL
    AND l.search_norm % qn
  ORDER BY similarity(l.search_norm, qn) DESC
  LIMIT p_lim;
END;
$$;

-- Wrapper that returns count (for pgbench scripts that expect a single count)
CREATE OR REPLACE FUNCTION listings.search_listings_fuzzy_count(
  p_user_id uuid,
  p_q text,
  p_lim bigint DEFAULT 50
)
RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT count(*)::bigint FROM listings.search_listings_fuzzy_ids(p_user_id, p_q, p_lim::integer);
$$;

-- Optional: vector extension + HNSW for ANN (semantic search). Uncomment and run when pgvector is installed.
-- CREATE EXTENSION IF NOT EXISTS vector;
-- ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS embedding vector(1536);  -- e.g. OpenAI dims
-- CREATE INDEX IF NOT EXISTS idx_listings_embedding_hnsw ON listings.listings
--   USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64)
--   WHERE embedding IS NOT NULL;
-- Then add a search_listings_knn_ann(user_id, query_embedding vector, lim) that uses ORDER BY embedding <=> query_embedding.

COMMENT ON FUNCTION listings.search_listings_fuzzy_ids(uuid, text, integer) IS 'Trigram fuzzy search on search_norm for pgbench and API.';
COMMENT ON FUNCTION listings.search_listings_fuzzy_count(uuid, text, bigint) IS 'Returns count of fuzzy search results for pgbench.';
