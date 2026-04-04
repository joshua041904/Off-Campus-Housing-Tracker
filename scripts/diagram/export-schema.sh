#!/usr/bin/env bash
# Export one service DB to JSON (tables, columns, indexes, foreign_keys).
# Usage: ./export-schema.sh <port> <dbname> <out.json>
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
  -f "$SCRIPT_DIR/sql/export_schema_json.sql" >"$out_json"
