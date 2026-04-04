-- Table activity + row counts for physical diagram heat overlay.
-- Run: psql -h HOST -p PORT -U USER -d DBNAME -X -t -A -f export_table_stats_json.sql
\set QUIET on
SELECT jsonb_pretty(
  jsonb_build_object(
    'database', current_database(),
    'generated_at', to_jsonb(now()),
    'table_stats',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'schema', s.schemaname,
          'name', s.relname,
          'n_live_tup', s.n_live_tup,
          'seq_scan', s.seq_scan,
          'idx_scan', s.idx_scan
        ) ORDER BY s.schemaname, s.relname
      )
      FROM pg_stat_user_tables s
      WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
    ), '[]'::jsonb)
  )
);
