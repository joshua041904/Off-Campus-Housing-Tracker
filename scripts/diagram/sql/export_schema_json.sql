-- One-row JSON snapshot of user tables: columns, indexes, FK graph.
-- Run: psql -h HOST -p PORT -U USER -d DBNAME -X -t -A -f export_schema_json.sql
\set QUIET on
SELECT jsonb_pretty(
  jsonb_build_object(
    'database', current_database(),
    'generated_at', to_jsonb(now()),
    'tables',
    COALESCE((
      SELECT jsonb_agg(obj ORDER BY schema_name, table_name)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          jsonb_build_object(
            'schema', n.nspname,
            'name', c.relname,
            'columns', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', a.attname,
                  'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                  'nullable', NOT a.attnotnull
                ) ORDER BY a.attnum
              )
              FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            ), '[]'::jsonb),
            'indexes', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', ic.relname,
                  'def', pg_catalog.pg_get_indexdef(ix.indexrelid)
                ) ORDER BY ic.relname
              )
              FROM pg_index ix
              JOIN pg_class ic ON ic.oid = ix.indexrelid
              WHERE ix.indrelid = c.oid
            ), '[]'::jsonb)
          ) AS obj
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ) t
    ), '[]'::jsonb),
    'foreign_keys',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', con.conname,
          'from_schema', ns.nspname,
          'from_table', cl.relname,
          'from_cols', (
            SELECT jsonb_agg(a.attname ORDER BY u.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
          ),
          'to_schema', nfs.nspname,
          'to_table', clf.relname,
          'to_cols', (
            SELECT jsonb_agg(a.attname ORDER BY u.ord)
            FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum
          )
        ) ORDER BY ns.nspname, cl.relname, con.conname
      )
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class clf ON clf.oid = con.confrelid
      JOIN pg_namespace nfs ON nfs.oid = clf.relnamespace
      WHERE con.contype = 'f'
        AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    ), '[]'::jsonb)
  )
);
