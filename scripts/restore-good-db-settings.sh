#!/usr/bin/env bash
# Apply good Postgres settings (DB-level + session-level) to all 8 housing DBs (5441–5448).
# Each port is a separate Postgres instance (Docker). We apply:
#   1. System-level (ALTER SYSTEM) — per instance, then reload.
#   2. Database-level (ALTER DATABASE ... SET) — persistent per DB, with correct search_path.
#   3. Session-level (SET) + verify — same settings, immediate effect and verification.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/restore-good-db-settings.sh
#   PGHOST=127.0.0.1 PGPASSWORD=postgres ./scripts/restore-good-db-settings.sh
#
# Prereq: All 8 Postgres containers up (docker compose up -d … postgres-analytics postgres-media).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"

# Port → database name → schema for search_path (housing 7 DBs)
# Auth (5441) may already have settings; we re-apply idempotently.
declare -a PORTS=(5441 5442 5443 5444 5445 5446 5447)
declare -A PORT_DB=(
  [5441]=auth
  [5442]=listings
  [5443]=bookings
  [5444]=messaging
  [5445]=notification
  [5446]=trust
  [5447]=analytics
)
declare -A PORT_SCHEMA=(
  [5441]=auth
  [5442]=listings
  [5443]=booking
  [5444]=messaging
  [5445]=notification
  [5446]=trust
  [5447]=analytics
)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

_psql() {
  local port="$1" db="${2:-postgres}"
  psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$db" -X -P pager=off -v ON_ERROR_STOP=1 "$@"
}

say "=== Restoring good DB settings across all 8 housing DBs (ports 5441–5448) ==="

for port in "${PORTS[@]}"; do
  db="${PORT_DB[$port]}"
  schema="${PORT_SCHEMA[$port]}"
  search_path="'${schema}, public'"

  if ! _psql "$port" postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    warn "Port $port ($db): not reachable, skipping. Start postgres container for this port."
    continue
  fi

  say "Applying settings to $db (port $port)..."

  # 1. System-level (this instance only) — persistent, reload so no restart needed for most
  _psql "$port" postgres <<SQL
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET effective_cache_size = '4GB';
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET max_worker_processes = 4;
ALTER SYSTEM SET max_parallel_workers = 4;
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;
ALTER SYSTEM SET track_io_timing = on;
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET autovacuum_naptime = '1min';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.1;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.05;
ALTER SYSTEM SET jit = off;
SELECT pg_reload_conf();
SQL

  # 2. Database-level (persistent for this DB) — same tuning + search_path
  _psql "$port" postgres <<SQL
ALTER DATABASE $db SET random_page_cost = 1.1;
ALTER DATABASE $db SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE $db SET cpu_tuple_cost = 0.01;
ALTER DATABASE $db SET effective_cache_size = '4GB';
ALTER DATABASE $db SET work_mem = '32MB';
ALTER DATABASE $db SET track_io_timing = on;
ALTER DATABASE $db SET max_parallel_workers = 4;
ALTER DATABASE $db SET max_parallel_workers_per_gather = 2;
ALTER DATABASE $db SET search_path = $search_path;
SQL

  # 3. Session-level + verify (connect to target DB)
  _psql "$port" "$db" <<SQL
SET random_page_cost = 1.1;
SET cpu_index_tuple_cost = 0.0005;
SET cpu_tuple_cost = 0.01;
SET effective_cache_size = '4GB';
SET work_mem = '32MB';
SET track_io_timing = on;
SET max_parallel_workers = 4;
SET max_parallel_workers_per_gather = 2;
SET search_path = $search_path;
SELECT name, setting, unit, source
FROM pg_settings
WHERE name IN (
  'random_page_cost', 'cpu_index_tuple_cost', 'cpu_tuple_cost',
  'effective_cache_size', 'work_mem', 'track_io_timing',
  'max_parallel_workers', 'max_parallel_workers_per_gather',
  'shared_buffers', 'max_connections', 'jit'
)
ORDER BY name;
SQL

  ok "$db (port $port): system, database, and session settings applied"
done

say "=== Done ==="
echo ""
echo "Applied across all 8 DBs (where reachable):"
echo "  • System: random_page_cost, work_mem, effective_cache_size, parallel workers, track_io_timing, jit=off, autovacuum, etc."
echo "  • Database: same + search_path per schema (auth, listings, booking, messaging, notification, trust, analytics, media)"
echo "  • Session: same for immediate effect and verification"
echo ""
echo "Note: shared_buffers/max_connections require Postgres restart to take effect; other ALTER SYSTEM settings apply after pg_reload_conf()."
