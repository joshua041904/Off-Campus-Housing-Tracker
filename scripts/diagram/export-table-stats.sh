#!/usr/bin/env bash
# Export pg_stat_user_tables snapshot for heat overlay (merge with schema JSON).
# Usage: ./export-table-stats.sh <port> <dbname> <out.json>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

port="${1:?port}"
dbname="${2:?dbname}"
out_json="${3:?out.json}"

mkdir -p "$(dirname "$out_json")"
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -t -A \
  -f "$SCRIPT_DIR/sql/export_table_stats_json.sql" >"$out_json"
