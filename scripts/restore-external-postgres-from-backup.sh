#!/usr/bin/env bash
# Restore all 8 housing Postgres DBs from a backup directory (e.g. backups/all-8-20260318-174510).
# Directory must contain 5441-auth.dump … 5448-media.dump (or .sql.gz). Each restored to same port.
# Called by bring-up-external-infra.sh when RESTORE_BACKUP_DIR is set.
#
# Usage: ./scripts/restore-external-postgres-from-backup.sh <backup-dir>
#   PGPASSWORD=postgres ./scripts/restore-external-postgres-from-backup.sh backups/all-8-20260318-174510
#   RESTORE_BACKUP_DIR=latest ./scripts/bring-up-external-infra.sh  # resolves latest then calls this

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${1:-}"
if [[ -z "$BACKUP_DIR" ]] || [[ ! -d "$BACKUP_DIR" ]]; then
  echo "Usage: $0 <backup-dir>" >&2
  echo "Example: $0 backups/all-8-20260318-174510" >&2
  exit 1
fi

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

# port:dbname (8 DBs; 5448 media restored if 5448-media.dump or .sql.gz present)
declare -A PORT_DB=(
  [5441]=auth
  [5442]=listings
  [5443]=bookings
  [5444]=messaging
  [5445]=notification
  [5446]=trust
  [5447]=analytics
  [5448]=media
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Restore external Postgres from $BACKUP_DIR ==="

for port in 5441 5442 5443 5444 5445 5446 5447 5448; do
  db="${PORT_DB[$port]}"
  dump="$BACKUP_DIR/${port}-${db}.dump"
  sqlgz="$BACKUP_DIR/${port}-${db}.sql.gz"
  if [[ -f "$dump" ]]; then
    echo "Restoring $db (port $port) from $dump ..."
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
    pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" --no-owner --no-privileges "$dump" 2>/dev/null || true
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "ANALYZE;" 2>/dev/null || true
    ok "$db (port $port)"
  elif [[ -f "$sqlgz" ]]; then
    echo "Restoring $db (port $port) from $sqlgz ..."
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
    gunzip -c "$sqlgz" | psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 2>/dev/null || true
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "ANALYZE;" 2>/dev/null || true
    ok "$db (port $port)"
  else
    warn "No $dump or $sqlgz; skipping $db (port $port)"
  fi
done

say "Restore from $BACKUP_DIR done. Run verify-bootstrap.sh and/or inspect-external-db-schemas.sh to confirm."
