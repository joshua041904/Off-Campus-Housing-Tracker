#!/usr/bin/env bash
# Run scripts/sql/real-query-plan-suite/*.sql against the default OCH ports and append to a Markdown report.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUITE_DIR="$REPO_ROOT/scripts/sql/real-query-plan-suite"
REPORT_BASE="${REPORT_BASE:-$REPO_ROOT/reports}"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$REPORT_BASE/real-query-plans-$TS.md"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
SKIP_ANALYZE="${SKIP_EXPLAIN_ANALYZE:-0}"
STMT_MS="${EXPLAIN_STATEMENT_TIMEOUT_MS:-60000}"

mkdir -p "$REPORT_BASE"

map_port_db() {
  case "$1" in
    01-listings*) echo "5442 listings" ;;
    02-booking*) echo "5443 bookings" ;;
    03-messaging*|04-messaging*) echo "5444 messaging" ;;
    05-auth*) echo "5441 auth" ;;
    *) echo "" ;;
  esac
}

prepend_explain_mode() {
  local f="$1"
  if [[ "$SKIP_ANALYZE" == "1" ]]; then
    sed 's/EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)/EXPLAIN (VERBOSE, FORMAT TEXT)/g' "$f"
  else
    cat "$f"
  fi
}

{
  echo "# Real query plan suite — $TS"
  echo ""
  echo "Host \`$PGHOST\`. Mode: $([[ "$SKIP_ANALYZE" == "1" ]] && echo EXPLAIN only || echo 'EXPLAIN ANALYZE BUFFERS')."
  echo ""
} >"$REPORT"

shopt -s nullglob
for sql in "$SUITE_DIR"/*.sql; do
  base="$(basename "$sql")"
  [[ "$base" == "README.md" ]] && continue
  pb="$(map_port_db "$base")"
  [[ -z "$pb" ]] && continue
  port="${pb%% *}"
  dbname="${pb#* }"
  echo "## $base → port $port / $dbname" >>"$REPORT"
  echo "" >>"$REPORT"
  echo '```text' >>"$REPORT"
  if ! {
    echo "SET statement_timeout = '${STMT_MS}ms';"
    prepend_explain_mode "$sql"
  } | PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -P pager=off \
    -v ON_ERROR_STOP=0 -f - >>"$REPORT" 2>&1; then
    echo "(psql exited non-zero — see above)" >>"$REPORT"
  fi
  echo '```' >>"$REPORT"
  echo "" >>"$REPORT"
done

echo "Wrote $REPORT"
