-- Analytics: recommendation model versions, weights, and experiments.
-- Run after 02-analytics-projections.sql against database 'analytics' on port 5447.
-- Supports: versioned ranking models, traffic-split experiments, deterministic user bucketing.

CREATE TABLE IF NOT EXISTS analytics.recommendation_models (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analytics.recommendation_models IS
  'Versioned recommendation models (e.g. baseline-ranking v1, geo-boost v2). Only one baseline active at a time.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_rec_models_name_version
  ON analytics.recommendation_models(name, version);

-- Weights per model (DB-controlled; service loads weights by model_id)
CREATE TABLE IF NOT EXISTS analytics.recommendation_weights (
  model_id    INT PRIMARY KEY REFERENCES analytics.recommendation_models(id) ON DELETE CASCADE,
  distance    NUMERIC NOT NULL,
  price       NUMERIC NOT NULL,
  popularity  NUMERIC NOT NULL,
  trust       NUMERIC NOT NULL,
  recency     NUMERIC NOT NULL
);

COMMENT ON TABLE analytics.recommendation_weights IS
  'Per-model weights for hybrid recommendation scoring (distance, price, popularity, trust, recency).';

-- Experiments: map traffic percentage to a specific model
CREATE TABLE IF NOT EXISTS analytics.recommendation_experiments (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  model_id           INT NOT NULL REFERENCES analytics.recommendation_models(id) ON DELETE CASCADE,
  traffic_percentage INT NOT NULL, -- 0–100
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE analytics.recommendation_experiments IS
  'Traffic-split experiments for recommendation models. Deterministic user bucketing (hash(user_id) % 100) selects experiment vs baseline.';

