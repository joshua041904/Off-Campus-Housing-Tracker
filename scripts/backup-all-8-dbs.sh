#!/usr/bin/env bash
# Hard backup of all 7 external Postgres instances (housing platform): full schema, indexes, data, and tuning metadata.
# Use when you need a complete snapshot so you can restore everything after a loss.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/backup-all-8-dbs.sh
#   BACKUP_DIR=/path/to/backups PGHOST=127.0.0.1 ./scripts/backup-all-8-dbs.sh
#
# Output: backups/all-7-YYYYMMDD-HHMMSS/ (or BACKUP_DIR)
#   - <port>-<dbname>.dump     (pg_dump -Fc: custom format for pg_restore)
#   - <port>-<dbname>.sql.gz   (plain SQL, compressed, for portability)
#   - <port>-<dbname>.sql      (plain SQL, only if BACKUP_PLAIN_SQL=1; good for piping)
#   - <port>-<dbname>-pg_settings.tsv
#   - <port>-<dbname>-extensions.tsv
#   - manifest.txt             (port, db, files, timestamp)
#
# Restore: see docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md (restore script or per-DB).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
TS="${BACKUP_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_BASE="${BACKUP_DIR:-$REPO_ROOT/backups}"
OUTDIR="$BACKUP_BASE/all-7-$TS"
PARALLEL_JOBS="${PG_DUMP_JOBS:-4}"
# When 1, use Docker postgres:16 for pg_dump/psql (avoids "server version mismatch" if host client is older)
USE_PG_DOCKER="${USE_PG_DOCKER:-}"

# Port → database name (housing platform: 5441–5447)
declare -A PORT_DB=(
  [5441]=auth
  [5442]=listings
  [5443]=bookings
  [5444]=messaging
  [5445]=notification
  [5446]=trust
  [5447]=analytics
)

# Host that containers use to reach host Postgres (Mac/Windows: host.docker.internal; Linux: host-gateway or 172.17.0.1)
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
    echo "❌ pg_dump and psql are required (e.g. brew install libpq), or Docker for postgres:16." >&2
    exit 1
  fi
fi

mkdir -p "$OUTDIR"
MANIFEST="$OUTDIR/manifest.txt"

# Run psql (for metadata); used only when USE_PG_DOCKER=1.
_run_psql() {
  local port="$1" db="$2" query="$3"
  docker run --rm \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:16-alpine \
    psql -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -Atc "$query"
}
{
  echo "Backup all 7 DBs (5441–5447) — $TS"
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

  # Full dump: schema + data + indexes (custom format for pg_restore)
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

  # Plain SQL (portable, gzipped)
  if [[ "${USE_PG_DOCKER}" == "1" ]]; then
    docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
      sh -c "pg_dump -h $PGHOST_FOR_DOCKER -p $port -U $PGUSER -d $db -Fp --no-owner --no-privileges | gzip -9 > /backup/$basename_sql.gz"
  else
    pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges 2>/dev/null | gzip -9 > "${out}.sql.gz"
  fi

  # Optional: plain .sql per DB (pipe-friendly: psql ... -f 5433-records.sql)
  if [[ "${BACKUP_PLAIN_SQL:-0}" == "1" ]]; then
    if [[ "${USE_PG_DOCKER}" == "1" ]]; then
      docker run --rm -e PGPASSWORD="$PGPASSWORD" -v "$OUTDIR:/backup:rw" postgres:16-alpine \
        pg_dump -h "$PGHOST_FOR_DOCKER" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges -f "/backup/$basename_sql"
    else
      pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -Fp --no-owner --no-privileges -f "${out}.sql" 2>/dev/null || true
    fi
  fi

  # Tuning metadata (for reference when restoring server config)
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

# If not already forced, detect version mismatch: server 16.x with local pg_dump 14.x fails.
if [[ -z "${USE_PG_DOCKER}" ]] && command -v pg_dump >/dev/null 2>&1; then
  probe_err=$(pg_dump -h "$PGHOST" -p 5441 -U "$PGUSER" -d auth -Fc --no-owner -f /dev/null 2>&1) || true
  if echo "$probe_err" | grep -q "server version mismatch"; then
    echo "⚠️  Local pg_dump is older than server; using Docker postgres:16-alpine for dumps."
    USE_PG_DOCKER=1
  fi
fi
if [[ "${USE_PG_DOCKER}" == "1" ]]; then
  echo "Using Docker (postgres:16-alpine) for pg_dump/psql; host seen as $PGHOST_FOR_DOCKER"
  echo ""
fi

echo "=== Hard backup: all 7 DBs (schema + indexes + data + tuning metadata) ==="
echo "Output: $OUTDIR"
echo ""

for port in 5441 5442 5443 5444 5445 5446 5447; do
  _dump_one "$port"
done

echo ""
echo "Finished: $(date -Iseconds)" >> "$MANIFEST"
echo "✅ Backup complete: $OUTDIR"
echo "   Manifest: $MANIFEST"
echo ""
echo "To restore a single DB:"
echo "  pg_restore -h $PGHOST -p 5441 -U $PGUSER -d auth --clean --if-exists -j 4 $OUTDIR/5441-auth.dump"
echo "  Or: gunzip -c $OUTDIR/5441-auth.sql.gz | psql -h $PGHOST -p 5441 -U $PGUSER -d auth -f -"
echo "  Or (if BACKUP_PLAIN_SQL=1): psql -h $PGHOST -p 5441 -U $PGUSER -d auth -f $OUTDIR/5441-auth.sql"
echo ""
echo "See docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md for full restore steps (all 7)."
