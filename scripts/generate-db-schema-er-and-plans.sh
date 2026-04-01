#!/usr/bin/env bash
# Generate Markdown: per-DB columns, indexes (+ stats), curated pg_settings, Mermaid ER (FK + PK/FK
# attributes per Mermaid entityRelationshipDiagram conventions), and EXPLAIN (ANALYZE, BUFFERS) samples.
# Complements scripts/inspect-external-db-schemas.sh (expected-table checklist).
#
# Usage: ./scripts/generate-db-schema-er-and-plans.sh [report-dir]
#   report-dir defaults to reports/; writes db-schema-er-<timestamp>.md
#
# Env:
#   PGHOST, PGPASSWORD, PGUSER — connection
#   INSPECT_DBS — multiline port:dbname:label (same as inspect-external-db-schemas.sh)
#   SKIP_EXPLAIN_ANALYZE=1 — use EXPLAIN only (no execute, no timing/buffers from runtime)
#   EXPLAIN_STATEMENT_TIMEOUT_MS — default 30000; applied with SET statement_timeout before ANALYZE
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"

REPORT_BASE="${1:-reports}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$REPORT_BASE/db-schema-er-${TIMESTAMP}.md"
mkdir -p "$REPORT_BASE"

SKIP_ANALYZE="${SKIP_EXPLAIN_ANALYZE:-0}"
STMT_MS="${EXPLAIN_STATEMENT_TIMEOUT_MS:-30000}"

if [[ -z "${INSPECT_DBS:-}" ]]; then
  INSPECT_DBS="5441:auth:auth
5442:listings:listings
5443:bookings:bookings
5444:messaging:messaging
5445:notification:notification
5446:trust:trust
5447:analytics:analytics
5448:media:media"
fi
if [[ -f "${INSPECT_DBS:-}" ]]; then
  DB_LIST="$(cat "$INSPECT_DBS")"
else
  DB_LIST="$INSPECT_DBS"
fi

mermaid_safe_id() {
  echo "$1" | tr '.' '_' | tr -cd '[:alnum:]_'
}

_psql() {
  local port="$1"
  local dbname="$2"
  shift 2
  # No ON_ERROR_STOP: optional blocks (missing tables, EXPLAIN) must not abort the whole report.
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X "$@"
}

{
  echo "# DB schema report: layout, indexes, settings, ER, and query plans — $TIMESTAMP"
  echo ""
  echo "Generated: \`$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')\`"
  echo ""
  echo "Host: \`$PGHOST\` (user: \`$PGUSER\`)."
  echo ""
  echo "**Query plans:** uses \`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\` on read-only SELECTs so you see **actual timings**, **buffer hits/reads**, and real planner behavior (same spirit as [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html))."
  if [[ "$SKIP_ANALYZE" == "1" ]]; then
    echo ""
    echo "> This run used \`SKIP_EXPLAIN_ANALYZE=1\` → **no ANALYZE** (plans only, no execution)."
  fi
  echo ""
  echo "**ER diagrams:** [Mermaid entity relationship syntax](https://mermaid.js.org/syntax/entityRelationshipDiagram.html) — entities list **PK/FK columns** with types; edges use \`||--o{\` (one-to-many from parent → child)."
  echo ""
  echo "Regenerate:"
  echo ""
  echo '```bash'
  echo "./scripts/generate-db-schema-er-and-plans.sh"
  echo "# optional: SKIP_EXPLAIN_ANALYZE=1 ./scripts/generate-db-schema-er-and-plans.sh"
  echo '```'
  echo ""
  echo "See also: [**docs/DB_SCHEMA_ER_AND_QUERY_PLANS.md**](../docs/DB_SCHEMA_ER_AND_QUERY_PLANS.md)."
  echo ""
  echo "---"
  echo ""
} > "$REPORT_FILE"

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"

  echo "## Port \`$port\` — $label (\`$dbname\`)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -t -A -c "SELECT 1" &>/dev/null; then
    echo "*Could not connect — skip this database.*" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    continue
  fi

  echo "### PostgreSQL version" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo '```text' >> "$REPORT_FILE"
  _psql "$port" "$dbname" -P pager=off -t -A -c "SELECT version();" >>"$REPORT_FILE" 2>&1 || true
  echo '```' >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  echo "### Curated \`pg_settings\`" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "High-signal planner, memory, WAL, and parallelism settings (full dump is \`SELECT * FROM pg_settings ORDER BY name\` in \`psql\`)." >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  _psql "$port" "$dbname" -P pager=off -c "
    SELECT name, setting, COALESCE(unit, '') AS unit, source
    FROM pg_settings
    WHERE name IN (
      'server_version', 'server_version_num',
      'shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem',
      'max_connections', 'random_page_cost', 'seq_page_cost', 'cpu_tuple_cost', 'cpu_index_tuple_cost',
      'effective_io_concurrency', 'max_worker_processes', 'max_parallel_workers_per_gather',
      'max_parallel_workers', 'max_parallel_maintenance_workers',
      'default_statistics_target', 'jit', 'jit_above_cost',
      'wal_level', 'max_wal_size', 'min_wal_size', 'checkpoint_timeout',
      'log_min_duration_statement', 'log_statement', 'track_io_timing',
      'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout'
    )
    ORDER BY name;
  " >>"$REPORT_FILE" 2>&1 || echo "(pg_settings query failed)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  echo "### Tables and columns" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  _psql "$port" "$dbname" -P pager=off -c "
    SELECT c.table_schema || '.' || c.table_name AS tbl,
           c.column_name,
           c.data_type,
           c.is_nullable
    FROM information_schema.columns c
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY tbl, c.ordinal_position;
  " >>"$REPORT_FILE" 2>&1 || echo "(column listing failed)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  echo "### Indexes (definitions)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "From \`pg_indexes\` (includes **UNIQUE** and **PRIMARY KEY** backing indexes)." >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  _psql "$port" "$dbname" -P pager=off -c "
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname, tablename, indexname;
  " >>"$REPORT_FILE" 2>&1 || echo "(pg_indexes failed)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  echo "### Index usage stats (\`pg_stat_user_indexes\`)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "Since stats reset: **idx_scan** / **idx_tup_read** / **idx_tup_fetch** (zero can mean idle or new cluster)." >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  _psql "$port" "$dbname" -P pager=off -c "
    SELECT schemaname, relname AS table_name, indexrelname AS index_name,
           idx_scan, idx_tup_read, idx_tup_fetch,
           pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
    FROM pg_stat_user_indexes
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY idx_scan DESC, pg_relation_size(indexrelid) DESC
    LIMIT 80;
  " >>"$REPORT_FILE" 2>&1 || echo "(pg_stat_user_indexes failed)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  keys_tmp="$(mktemp)"
  fk_tmp="$(mktemp)"
  rel_tmp="$(mktemp)"
  mer_tmp="$(mktemp)"

  _psql "$port" "$dbname" -t -A -F '|' -c "
    WITH pk AS (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name, 'PK' AS kt
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    ),
    fk AS (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name, 'FK' AS kt
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    ),
    pk_fk_cols AS (
      SELECT * FROM pk UNION SELECT * FROM fk
    )
    SELECT k.table_schema || '.' || k.table_name AS tbl,
           k.column_name,
           CASE
             WHEN c.data_type = 'uuid' THEN 'uuid'
             WHEN c.data_type IN ('character varying', 'text', 'character') THEN 'string'
             WHEN c.data_type = 'integer' THEN 'int'
             WHEN c.data_type = 'bigint' THEN 'bigint'
             WHEN c.data_type = 'smallint' THEN 'smallint'
             WHEN c.data_type = 'boolean' THEN 'bool'
             WHEN c.data_type = 'timestamp with time zone' THEN 'timestamptz'
             WHEN c.data_type = 'timestamp without time zone' THEN 'timestamp'
             WHEN c.data_type = 'double precision' THEN 'float'
             WHEN c.data_type = 'real' THEN 'float'
             WHEN c.data_type = 'numeric' THEN 'numeric'
             WHEN c.data_type = 'json' THEN 'json'
             WHEN c.data_type = 'jsonb' THEN 'jsonb'
             WHEN c.data_type = 'bytea' THEN 'bytes'
             WHEN c.data_type = 'ARRAY' THEN 'array'
             ELSE lower(replace(c.data_type, ' ', '_'))
           END AS mer_type,
           k.kt
    FROM pk_fk_cols k
    JOIN information_schema.columns c
      ON c.table_schema = k.table_schema AND c.table_name = k.table_name AND c.column_name = k.column_name
    ORDER BY tbl, CASE k.kt WHEN 'PK' THEN 0 WHEN 'FK' THEN 1 ELSE 2 END, c.ordinal_position;
  " >"$keys_tmp" 2>/dev/null || true

  _psql "$port" "$dbname" -t -A -F '|' -c "
    SELECT fn.nspname || '.' || fc.relname AS parent_tbl,
           n.nspname || '.' || c.relname AS child_tbl,
           con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class fc ON fc.oid = con.confrelid
    JOIN pg_namespace fn ON fn.oid = fc.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2, 3;
  " >"$fk_tmp" 2>/dev/null || true

  sort -u "$fk_tmp" >"$rel_tmp" 2>/dev/null || true

  echo "### ER diagram (Mermaid)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "Entities include **primary/foreign key columns** only (keeps diagrams readable). Relationships: parent \`||--o{\` child per FK." >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  if [[ ! -s "$rel_tmp" && ! -s "$keys_tmp" ]]; then
    echo "*No user foreign keys / key metadata found.*" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
  else
    {
      echo '```mermaid'
      echo "erDiagram"
      cur=""
      while IFS='|' read -r tbl col mtyp kt; do
        [[ -z "$tbl" ]] && continue
        eid="$(mermaid_safe_id "$tbl")"
        if [[ "$tbl" != "$cur" ]]; then
          [[ -n "$cur" ]] && echo "  }"
          cur="$tbl"
          echo "  ${eid} {"
        fi
        if [[ -n "$kt" ]]; then
          echo "    ${mtyp} ${col} ${kt}"
        else
          echo "    ${mtyp} ${col}"
        fi
      done <"$keys_tmp"
      [[ -n "$cur" ]] && echo "  }"
      while IFS='|' read -r parent child cname; do
        [[ -z "$parent" ]] && continue
        pid="$(mermaid_safe_id "$parent")"
        cid="$(mermaid_safe_id "$child")"
        safe_label="${cname//\"/\'}"
        echo "  ${pid} ||--o{ ${cid} : \"${safe_label}\""
      done <"$rel_tmp"
      echo '```'
    } >>"$mer_tmp"
    cat "$mer_tmp" >>"$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
  fi
  rm -f "$keys_tmp" "$fk_tmp" "$rel_tmp" "$mer_tmp"

  echo "### Sample query plans" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  if [[ "$SKIP_ANALYZE" == "1" ]]; then
    echo "Mode: **EXPLAIN** only (\`SKIP_EXPLAIN_ANALYZE=1\`)." >> "$REPORT_FILE"
  else
    echo "Mode: **EXPLAIN (ANALYZE, BUFFERS)** — runs the statement; \`statement_timeout=${STMT_MS}ms\`." >> "$REPORT_FILE"
  fi
  echo "" >> "$REPORT_FILE"

  explain_mode="EXPLAIN (FORMAT TEXT, COSTS ON)"
  if [[ "$SKIP_ANALYZE" != "1" ]]; then
    explain_mode="EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)"
  fi

  run_explain_block() {
    local title="$1"
    local sql_body="$2"
    echo "#### $title" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo '```text' >> "$REPORT_FILE"
    if [[ "$SKIP_ANALYZE" != "1" ]]; then
      _psql "$port" "$dbname" -P pager=off -c "SET statement_timeout = '${STMT_MS}ms'; ${explain_mode} ${sql_body}" >>"$REPORT_FILE" 2>&1 || echo "(plan failed or timed out)" >> "$REPORT_FILE"
    else
      _psql "$port" "$dbname" -P pager=off -c "${explain_mode} ${sql_body}" >>"$REPORT_FILE" 2>&1 || echo "(plan failed)" >> "$REPORT_FILE"
    fi
    echo '```' >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
  }

  if [[ "$port" == "5444" && "$dbname" == "messaging" ]]; then
    run_explain_block "Messaging — \`messaging.messages\` by conversation (uses \`idx_messages_conversation_created\` when present)" \
      "SELECT m.id, m.body, m.created_at FROM messaging.messages m WHERE m.conversation_id = '00000000-0000-0000-0000-000000000001'::uuid AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 50"
    run_explain_block "Messaging — \`messages.messages\` inbox by recipient (HTTP service path)" \
      "SELECT id, subject, content, created_at FROM messages.messages WHERE recipient_id = '00000000-0000-0000-0000-000000000002'::uuid ORDER BY created_at DESC LIMIT 20"
  else
    # Read-only probe: first user table LIMIT 1 (quoted identifiers from information_schema)
    first_tbl="$(_psql "$port" "$dbname" -t -A -c "
      SELECT format('%I.%I', table_schema, table_name)
      FROM information_schema.tables c
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND c.table_type = 'BASE TABLE'
      ORDER BY c.table_schema, c.table_name
      LIMIT 1;
    " 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "$first_tbl" ]]; then
      run_explain_block "Sample — first user table (LIMIT 1)" "SELECT * FROM ${first_tbl} LIMIT 1"
    else
      echo "*No user tables for sample EXPLAIN.*" >> "$REPORT_FILE"
      echo "" >> "$REPORT_FILE"
    fi
  fi

  echo "---" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
done <<<"$DB_LIST"

echo "Wrote $REPORT_FILE"
