#!/usr/bin/env bash
# Restore all 8 housing Postgres DBs from a backup directory (e.g. backups/all-8-20260318-174510).
# Directory must contain 5441-auth.dump … 5448-media.dump (or .sql.gz). Each restored to same port.
# Called by bring-up-external-infra.sh when RESTORE_BACKUP_DIR is set.
#
# Usage: ./scripts/restore-external-postgres-from-backup.sh <backup-dir>
#   PGPASSWORD=postgres ./scripts/restore-external-postgres-from-backup.sh backups/all-8-20260318-174510

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
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"

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
fail() { echo "❌ $*" >&2; exit 1; }

och_terminate_db_sessions() {
  local port="$1" db="$2"
  local i
  for i in 1 2 3 4 5; do
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=0 -q -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" 2>/dev/null || true
    sleep 1
  done
}

och_drop_and_create_db() {
  local port="$1" db="$2"
  och_terminate_db_sessions "$port" "$db"
  if ! psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" 2>/dev/null; then
    och_terminate_db_sessions "$port" "$db"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";"
  fi
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\";"
}

och_restore_fingerprint() {
  local port="$1" db="$2"
  case "$db" in
    bookings)
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -tA -c \
        "SELECT 'bookings=' || count(*)::text || ' watchlist=' || (SELECT count(*)::text FROM booking.watchlist_items) FROM booking.bookings;" 2>/dev/null || echo "bookings=?"
      ;;
    notification)
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -tA -c \
        "SELECT 'notifications=' || count(*)::text || ' booking_events=' || (SELECT count(*)::text FROM notification.notifications WHERE event_type ILIKE 'booking.%') FROM notification.notifications;" 2>/dev/null || echo "notification=?"
      ;;
    *)
      psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -tA -c "SELECT 1" >/dev/null 2>&1 && echo "ok" || echo "?"
      ;;
  esac
}

och_scale_down_host_db_clients() {
  if [[ "${RESTORE_SKIP_K8S_SCALE_DOWN:-0}" == "1" ]]; then
    return 0
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    return 0
  fi
  if ! kubectl get namespace "$HOUSING_NS" &>/dev/null; then
    return 0
  fi
  say "Scaling down workloads that pool host Postgres (restore safety)"
  for deploy in booking-service notification-service listings-service messaging-service trust-service analytics-service; do
    kubectl scale "deployment/$deploy" -n "$HOUSING_NS" --replicas=0 2>/dev/null || true
  done
  sleep 3
}

say "=== Restore external Postgres from $BACKUP_DIR ==="
och_scale_down_host_db_clients

for port in 5441 5442 5443 5444 5445 5446 5447 5448; do
  db="${PORT_DB[$port]}"
  dump="$BACKUP_DIR/${port}-${db}.dump"
  sqlgz="$BACKUP_DIR/${port}-${db}.sql.gz"
  if [[ -f "$dump" ]]; then
    echo "Restoring $db (port $port) from $dump ..."
    och_drop_and_create_db "$port" "$db"
    _restore_log="$(mktemp)"
    if ! pg_restore -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" --no-owner --no-privileges "$dump" >"$_restore_log" 2>&1; then
      if ! grep -q "TABLE DATA" "$_restore_log" 2>/dev/null; then
        warn "pg_restore reported errors for $db; see $_restore_log"
      fi
    fi
    rm -f "$_restore_log"
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "ANALYZE;" 2>/dev/null || true
    fp="$(och_restore_fingerprint "$port" "$db")"
    ok "$db (port $port) — $fp"
  elif [[ -f "$sqlgz" ]]; then
    echo "Restoring $db (port $port) from $sqlgz ..."
    och_drop_and_create_db "$port" "$db"
    gunzip -c "$sqlgz" | psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -c "ANALYZE;"
    fp="$(och_restore_fingerprint "$port" "$db")"
    ok "$db (port $port) — $fp"
  else
    warn "No $dump or $sqlgz; skipping $db (port $port)"
  fi
done

if [[ -x "$SCRIPT_DIR/apply-all-infra-db-migrations.sh" ]]; then
  say "Applying idempotent infra/db migrations on restored DBs (schema alignment only)"
  "$SCRIPT_DIR/apply-all-infra-db-migrations.sh" || warn "apply-all-infra-db-migrations.sh failed (non-fatal)"
fi

if [[ -x "$SCRIPT_DIR/verify-restore-data.sh" ]]; then
  "$SCRIPT_DIR/verify-restore-data.sh" || fail "Post-restore data verification failed"
fi

say "Restore from $BACKUP_DIR done. Run inspect-external-db-schemas.sh to confirm."
