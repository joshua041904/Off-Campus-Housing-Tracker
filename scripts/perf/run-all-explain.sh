#!/usr/bin/env bash
# Run EXPLAIN (ANALYZE, BUFFERS, VERBOSE) for all housing Postgres DBs (schemas).
# Skips unreachable databases; does not modify data.
#
# Usage:
#   ./scripts/perf/run-all-explain.sh [output.md]
#   PGHOST=127.0.0.1 PGPORT=5442 ./scripts/perf/run-all-explain.sh
#
# Env: PGHOST (default 127.0.0.1), PGUSER (postgres), PGPASSWORD (postgres)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SQL_DIR="$SCRIPT_DIR/sql"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
export PGHOST PGUSER PGPASSWORD

OUT="${1:-$REPO_ROOT/bench_logs/explain-all-$(date +%Y%m%d-%H%M%S).md}"
mkdir -p "$(dirname "$OUT")"

_psql_file() {
  local port="$1"
  local db="$2"
  local sqlfile="$3"
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
    -f "$sqlfile" 2>&1
}

_try_explain() {
  local name="$1" port="$2" db="$3" sqlfile="$4"
  echo ""
  echo "## $name (port $port, database \`$db\`)"
  echo ""
  echo '```'
  if [[ ! -f "$sqlfile" ]]; then
    echo "MISSING_SQL_FILE: $sqlfile"
    echo '```'
    return
  fi
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -c "SELECT 1" >/dev/null 2>&1; then
    echo "SKIP: could not connect to ${PGHOST}:${port}/${db} (start Docker Compose DBs or set PGHOST)."
    echo '```'
    return
  fi
  if ! _psql_file "$port" "$db" "$sqlfile"; then
    echo "(psql reported an error — check schema migrations match infra/db/*.sql)"
  fi
  echo '```'
}

{
  echo "# EXPLAIN ANALYZE — all housing databases"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Host: \`${PGHOST}\` user: \`${PGUSER}\`"
  echo ""
  echo "| Service | Port | Database | SQL file |"
  echo "|---------|------|----------|----------|"
  echo "| auth | 5441 | auth | explain-auth.sql |"
  echo "| listings | 5442 | listings | explain-listings.sql |"
  echo "| booking | 5443 | bookings | explain-bookings.sql |"
  echo "| messaging | 5444 | messaging | explain-messaging.sql |"
  echo "| notification | 5445 | notification | explain-notification.sql |"
  echo "| trust | 5446 | trust | explain-trust.sql |"
  echo "| analytics | 5447 | analytics | explain-analytics.sql |"
  echo "| media | 5448 | media | explain-media.sql |"
  echo ""

  _try_explain "auth" 5441 auth "$SQL_DIR/explain-auth.sql"
  _try_explain "listings" 5442 listings "$SQL_DIR/explain-listings.sql"
  _try_explain "booking" 5443 bookings "$SQL_DIR/explain-bookings.sql"
  _try_explain "messaging" 5444 messaging "$SQL_DIR/explain-messaging.sql"
  _try_explain "notification" 5445 notification "$SQL_DIR/explain-notification.sql"
  _try_explain "trust" 5446 trust "$SQL_DIR/explain-trust.sql"
  _try_explain "analytics" 5447 analytics "$SQL_DIR/explain-analytics.sql"
  _try_explain "media" 5448 media "$SQL_DIR/explain-media.sql"

  echo ""
  echo "---"
  echo "End of EXPLAIN section."
} | tee "$OUT"

echo ""
echo "Wrote: $OUT"
