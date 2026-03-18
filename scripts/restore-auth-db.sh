#!/usr/bin/env bash
# Restore auth DB from backups/5437-auth.dump (or .gz / .zip) into port 5441.
# Use after starting postgres-auth (e.g. docker compose up -d postgres-auth).
# Unzip: if dump is 5437-auth.dump.gz or 5437-auth.dump.zip, it is decompressed on the fly.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/restore-auth-db.sh
#   RESTORE_AUTH_DUMP=backups/5437-auth.dump.gz PGPASSWORD=postgres ./scripts/restore-auth-db.sh
#
# Prereqs: Postgres auth container up, port 5441 reachable.

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
# Allow .gz or .zip without changing RESTORE_AUTH_DUMP base name
if [[ ! -f "$DUMP_FILE" ]]; then
  if [[ -f "${DUMP_FILE}.gz" ]]; then DUMP_FILE="${DUMP_FILE}.gz"; fi
  if [[ -f "${DUMP_FILE}.zip" ]]; then DUMP_FILE="${DUMP_FILE}.zip"; fi
fi

PARALLEL_JOBS="${PG_RESTORE_JOBS:-4}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: Dump file not found: $DUMP_FILE" >&2
  echo "Place 5437-auth.dump (or .gz / .zip) in backups/ or set RESTORE_AUTH_DUMP=/path/to/dump" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "ERROR: pg_restore not found (e.g. brew install libpq)." >&2
  exit 1
fi

# Ensure DB exists (compose may have created it)
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -c "CREATE DATABASE $PGDB;" 2>/dev/null || true

echo "Restoring auth DB from $DUMP_FILE into $PGHOST:$PGPORT/$PGDB ..."

if [[ "$DUMP_FILE" == *.gz ]]; then
  gunzip -c "$DUMP_FILE" | pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" \
    --clean --if-exists -j "${PARALLEL_JOBS}" -v || true
elif [[ "$DUMP_FILE" == *.zip ]]; then
  unzip -p "$DUMP_FILE" '*.dump' 2>/dev/null | pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" \
    --clean --if-exists -j "${PARALLEL_JOBS}" -v || true
  [[ ${PIPESTATUS[0]} -eq 0 ]] || unzip -p "$DUMP_FILE" | pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" \
    --clean --if-exists -j "${PARALLEL_JOBS}" -v || true
else
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" \
    --clean --if-exists -j "${PARALLEL_JOBS}" -v "$DUMP_FILE" || true
fi

echo "Running ANALYZE on $PGDB ..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "ANALYZE;" 2>/dev/null || true
echo "Done. Verify with: psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB -c '\\dt auth.*'"
