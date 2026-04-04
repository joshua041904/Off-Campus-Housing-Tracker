#!/usr/bin/env bash
# Emit Markdown index audit matrix: definition + idx_scan + size (per OCH DB).
# Usage: ./generate-index-audit-md.sh [report.md]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT="${1:-$REPO_ROOT/reports/index-audit-$(date +%Y%m%d-%H%M%S).md}"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"

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

mkdir -p "$(dirname "$REPORT")"
{
  echo "# Index audit matrix — $(date -Iseconds 2>/dev/null || date)"
  echo ""
  echo "Fill **Purpose**, **Redundant?**, **Action** after review. **idx_scan = 0** after steady load may mean dead index (verify workload)."
  echo ""
} >"$REPORT"

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"
  {
    echo "## ${label} (\`${dbname}\` @ ${port})"
    echo ""
    echo "| schema | table | index | idx_scan | idx_tup_read | index_size | definition (truncated) |"
    echo "|--------|-------|-------|----------|--------------|------------|--------------------------|"
  } >>"$REPORT"
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -t -A -F '|' -c "SELECT 1" &>/dev/null; then
    echo "*unreachable*" >>"$REPORT"
    echo "" >>"$REPORT"
    continue
  fi
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -P pager=off -t -A -F '|' -c "
    SELECT s.schemaname, s.relname, s.indexrelname,
           s.idx_scan::text, s.idx_tup_read::text,
           pg_size_pretty(pg_relation_size(s.indexrelid)),
           LEFT(pi.indexdef, 120)
    FROM pg_stat_user_indexes s
    JOIN pg_indexes pi ON pi.schemaname = s.schemaname AND pi.tablename = s.relname AND pi.indexname = s.indexrelname
    WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY s.idx_scan DESC, pg_relation_size(s.indexrelid) DESC;
  " 2>/dev/null | while IFS='|' read -r sch tbl idx scans reads sz def; do
    [[ -z "$sch" ]] && continue
    echo "| $sch | $tbl | $idx | $scans | $reads | $sz | \`${def}\` |" >>"$REPORT"
  done
  echo "" >>"$REPORT"
  echo "| Purpose | Redundant? | Action |" >>"$REPORT"
  echo "|---------|------------|--------|" >>"$REPORT"
  echo "| *(manual)* | | |" >>"$REPORT"
  echo "" >>"$REPORT"
done <<<"$DB_LIST"

echo "Wrote $REPORT"
