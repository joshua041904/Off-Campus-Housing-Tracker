#!/usr/bin/env bash
# Hard backup of all 8 external Postgres instances (housing platform): auth, listings, bookings, messaging, notification, trust, analytics, media.
# Full schema, indexes, data, and tuning metadata.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/backup-all-8-dbs.sh
#   BACKUP_DIR=/path/to/backups PGHOST=127.0.0.1 ./scripts/backup-all-8-dbs.sh
#
# Output: backups/all-8-YYYYMMDD-HHMMSS/ (or BACKUP_DIR)
#   - <port>-<dbname>.dump     (pg_dump -Fc: custom format for pg_restore)
#   - <port>-<dbname>.sql.gz   (plain SQL, compressed)
#   - manifest.txt
#
# Restore: RESTORE_BACKUP_DIR=backups/all-8-<timestamp> ./scripts/bring-up-external-infra.sh or ./scripts/restore-external-postgres-from-backup.sh <dir>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
TS="${BACKUP_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_BASE="${BACKUP_DIR:-$REPO_ROOT/backups}"
OUTDIR="$BACKUP_BASE/all-8-$TS"
PARALLEL_JOBS="${PG_DUMP_JOBS:-4}"
USE_PG_DOCKER="${USE_PG_DOCKER:-}"

# Port → database name (housing platform: 5441–5448)
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

PGHOST_FOR_DOCKER="${PGHOST_FOR_DOCKER:-}"
if [[ -z "$PGHOST_FOR_DOCKER" ]]; then
  if [[ "$PGHOST" == "127.0.0.1" ]] || [[ "$PGHOST" == "localhost" ]]; then
    PGHOST_FOR_DOCKER="host.docker.internal"
  else
    PGHOST_FOR_DOCKER="$PGHOST"
  fi
fi

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1; then
    USE_PG_DOCKER=1
  else
    echo "❌ pg_dump and psql required (e.g. brew install libpq), or Docker." >&2
    exit 1
  fi
fi

mkdir -p "$OUTDIR"
MANIFEST="$OUTDIR/manifest.txt"

_run_psql() {
  local port="$1" db="$2" query="$3"
  docker run --rm \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:16-alpine \
    psql -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -Atc "$query"
}

{
  echo "Backup all 8 DBs (5441–5448) — $TS"
  echo "Host: $PGHOST"
  echo "Started: $(date -Iseconds)"
  echo ""
} > "$MANIFEST"

_dump_one() {
  local port="$1"
  local db="${PORT_DB[$port]}"
  local label="${port}-${db}"
  local out="$OUTDIR/$label"
  local basename_dump="$label.dump"
  local basename_sql="$label.sql"

  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    if ! docker run --rm -e PGPASSWORD="$PGPASSWORD" postgres:16-alpine \
      psql -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -c "SELECT 1;" >/dev/null 2>&1; then
      echo "⚠️  $label: skip (cannot connect)"
      echo "skip $label (connect failed)" >> "$MANIFEST"
      return 0
    fi
  else
    if ! PGCONNECT_TIMEOUT=5 psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -c "SELECT 1;" >/dev/null 2>&1; then
      echo "⚠️  $label: skip (cannot connect)"
      echo "skip $label (connect failed)" >> "$MANIFEST"
      return 0
    fi
  fi

  echo "Backing up $label ..."

  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fc -j "$PARALLEL_JOBS" \
        --no-owner --no-privileges -f "/backup/$basename_dump" 2>/dev/null || \
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fc \
        --no-owner --no-privileges -f "/backup/$basename_dump"
  else
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      -Fc -j "$PARALLEL_JOBS" --no-owner --no-privileges -f "${out}.dump" 2>/dev/null || \
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" \
      -Fc --no-owner --no-privileges -f "${out}.dump"
  fi

  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      sh -c "pg_dump -h $PGHOST_FOR_DOCKER -p $port -U $PGUSER -d $db -Fp --no-owner --no-privileges | gzip -9 > /backup/$basename_sql.gz"
  else
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges 2>/dev/null | gzip -9 > "${out}.sql.gz"
  fi

  if [[ "${BACKUP_PLAIN_SQL:-0}" == "1" ]]; then
    if [[ "${USE_PG_DOCKER}" == "1" ]]; then
      docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
        pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges -f "/backup/$basename_sql"
    else
      pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges -f "${out}.sql" 2>/dev/null || true
    fi
  fi

  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    _run_psql "$port" "$db" "SELECT name||E'\t'||setting||E'\t'||source FROM pg_settings ORDER BY name" > "${out}-pg_settings.tsv" 2>/dev/null || true
    _run_psql "$port" "$db" "SELECT extname||E'\t'||extversion FROM pg_extension ORDER BY 1" > "${out}-extensions.tsv" 2>/dev/null || true
  else
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -Atc \
      "SELECT name||E'\t'||setting||E'\t'||source FROM pg_settings ORDER BY name" \
      > "${out}-pg_settings.tsv" 2>/dev/null || true
    psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -Atc \
      "SELECT extname||E'\t'||extversion FROM pg_extension ORDER BY 1" \
      > "${out}-extensions.tsv" 2>/dev/null || true
  fi

  local size_dump="$(ls -lh "${out}.dump" 2>/dev/null | awk '{print $5}')"
  local size_sql="$(ls -lh "${out}.sql.gz" 2>/dev/null | awk '{print $5}')"
  echo "  ${out}.dump ($size_dump), ${out}.sql.gz ($size_sql)"
  manifest_line="ok $label ${out}.dump ${out}.sql.gz"
  [[ -f "${out}.sql" ]] && manifest_line="$manifest_line ${out}.sql"
  echo "$manifest_line" >> "$MANIFEST"
}

if [[ -z "${USE_PG_DOCKER}" ]] && command -v pg_dump >/dev/null 2>&1; then
  probe_err=$(pg_dump -h "$PGHOST" -p 5441 -U "$PGUSER" -d auth -Fc --no-owner -f /dev/null 2>&1) || true
  if echo "$probe_err" | grep -q "server version mismatch"; then
    echo "⚠️  Local pg_dump older than server; using Docker postgres:16-alpine."
    USE_PG_DOCKER=1
  fi
fi
if [[ "${USE_PG_DOCKER}" == "1" ]]; then
  echo "Using Docker (postgres:16-alpine) for pg_dump/psql; host seen as $PGHOST_FOR_DOCKER"
  echo ""
fi

echo "=== Hard backup: all 8 DBs (5441–5448, schema + data + tuning metadata) ==="
echo "Output: $OUTDIR"
echo ""

for port in 5441 5442 5443 5444 5445 5446 5447 5448; do
  _dump_one "$port"
done

echo ""
echo "Finished: $(date -Iseconds)" >> "$MANIFEST"
echo "✅ Backup complete: $OUTDIR"
echo "   Restore: RESTORE_BACKUP_DIR=$OUTDIR ./scripts/bring-up-external-infra.sh  or  ./scripts/restore-external-postgres-from-backup.sh $OUTDIR"
echo ""
