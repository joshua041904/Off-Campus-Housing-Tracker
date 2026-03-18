#!/usr/bin/env bash
# Restore the legacy auth dump (5437-auth.dump) into the housing auth DB on port 5441.
# Use this when you have a dump from the old port (5437) and want to load it into
# the current housing stack (postgres-auth on host port 5441).
#
# Usage:
#   PGPASSWORD=postgres ./scripts/restore-auth-from-legacy-dump.sh
#   RESTORE_AUTH_DUMP=backups/5437-auth.dump PGPASSWORD=postgres ./scripts/restore-auth-from-legacy-dump.sh
#
# Prereqs: Postgres auth container up (docker compose up -d postgres-auth), port 5441 reachable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5441}"
PGUSER="${PGUSER:-postgres}"
PGDB="${PGDB:-auth}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

DUMP_FILE="${RESTORE_AUTH_DUMP:-$REPO_ROOT/backups/5437-auth.dump}"
PARALLEL_JOBS="${PG_RESTORE_JOBS:-4}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: Dump file not found: $DUMP_FILE" >&2
  echo "Place 5437-auth.dump in backups/ or set RESTORE_AUTH_DUMP=/path/to/dump" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found (e.g. brew install libpq)." >&2
  exit 1
fi

echo "Restoring auth DB from $DUMP_FILE into $PGHOST:$PGPORT/$PGDB ..."
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" \
  --clean --if-exists \
  -j "${PARALLEL_JOBS}" \
  -v \
  "$DUMP_FILE" || true
# pg_restore exits with 1 when there are harmless warnings (e.g. role "postgres" already exists); allow that.

echo "Running ANALYZE on $PGDB ..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "ANALYZE;" 2>/dev/null || true

echo "Done. Verify with: psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB -c '\\dt auth.*'"
