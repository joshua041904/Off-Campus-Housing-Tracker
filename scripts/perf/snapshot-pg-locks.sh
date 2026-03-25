#!/usr/bin/env bash
# Snapshot Postgres locks / waiters while running k6 dual contention (Issue 10).
# Run in a second terminal during load; safe to run repeatedly.
#
# Usage:
#   PGPORT=5442 PGPASSWORD=postgres ./scripts/perf/snapshot-pg-locks.sh
#   PGPORT=5447 ./scripts/perf/snapshot-pg-locks.sh   # analytics DB
#
set -euo pipefail
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5442}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB="${1:-listings}"

echo "=== $(date -Iseconds) === $PGHOST:$PGPORT db=$DB"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -c "
SELECT relation::regclass AS rel, mode, count(*) AS n
FROM pg_locks
WHERE NOT granted
GROUP BY relation, mode
ORDER BY n DESC;
"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -c "
SELECT pid, usename, wait_event_type, wait_event, state, left(query, 120) AS query_preview
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND wait_event IS NOT NULL
ORDER BY query_start NULLS LAST
LIMIT 25;
"
