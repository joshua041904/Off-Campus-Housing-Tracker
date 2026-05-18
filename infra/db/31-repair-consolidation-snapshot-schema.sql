-- Rollback snapshots for scripts/repair-restored-user-ownership.ts (auth DB).
--   PGPASSWORD=postgres psql -h localhost -p 5441 -U postgres -d auth \
--     -v ON_ERROR_STOP=1 -f infra/db/31-repair-consolidation-snapshot-schema.sql

CREATE SCHEMA IF NOT EXISTS repair;

CREATE TABLE IF NOT EXISTS repair.consolidation_row_snapshots (
  snapshot_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  canonical_user_id UUID NOT NULL,
  source_user_id    UUID NOT NULL,
  target_database   TEXT NOT NULL,
  target_schema     TEXT NOT NULL,
  target_table      TEXT NOT NULL,
  row_pk            JSONB NOT NULL,
  before_data       JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consolidation_snapshots_run
  ON repair.consolidation_row_snapshots (run_id);

CREATE INDEX IF NOT EXISTS idx_consolidation_snapshots_source
  ON repair.consolidation_row_snapshots (source_user_id, target_database, target_table);

COMMENT ON TABLE repair.consolidation_row_snapshots IS
  'Pre-image rows before repair-restored-user-ownership.ts --apply. Use run_id to generate rollback SQL.';
