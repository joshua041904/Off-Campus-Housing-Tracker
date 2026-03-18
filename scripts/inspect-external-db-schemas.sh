#!/usr/bin/env bash
# Inspect external Postgres DBs and write a schema report (portable, PGPASSWORD in script, MD with timestamp).
# Usage: ./scripts/inspect-external-db-schemas.sh [report-dir]
#   report-dir defaults to reports/; report: report-dir/schema-report-<timestamp>.md
# Env: PGHOST (default localhost), PGPASSWORD (default postgres). DB list from INSPECT_DBS or built-in 8-DB layout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"

REPORT_BASE="${1:-reports}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="$REPORT_BASE/schema-report-$TIMESTAMP.md"
mkdir -p "$REPORT_BASE"

# Default: 8 DBs (off-campus-housing-tracker layout). Format: port:dbname:label
if [[ -z "${INSPECT_DBS:-}" ]]; then
  INSPECT_DBS="5433:records:records
5434:records:social
5435:records:listings
5436:records:shopping
5437:auth:auth
5438:records:auction_monitor
5439:records:analytics
5440:python_ai:python_ai"
fi
if [[ -f "${INSPECT_DBS:-}" ]]; then
  DB_LIST="$(cat "$INSPECT_DBS")"
else
  DB_LIST="$INSPECT_DBS"
fi

echo "=== Inspect external DB schemas ==="
echo "Report: $REPORT_FILE"
echo ""

{
  echo "# External DB schema report — $TIMESTAMP"
  echo ""
  echo "Generated: $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"
  echo ""
  echo "Host: \`$PGHOST\` (user: $PGUSER)"
  echo ""
} > "$REPORT_FILE"

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"
  echo "## Port $port — $label (\`$dbname\`)" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -P pager=off -c "
    SELECT n.nspname AS schema, c.relname AS table_name, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, c.relname;
  " 2>/dev/null >> "$REPORT_FILE"; then
    echo "*(connection or query failed)*" >> "$REPORT_FILE"
  fi
  echo "" >> "$REPORT_FILE"
  echo "  Inspected $port $dbname ($label)"
done <<< "$DB_LIST"

echo ""
echo "Report: $REPORT_FILE"
