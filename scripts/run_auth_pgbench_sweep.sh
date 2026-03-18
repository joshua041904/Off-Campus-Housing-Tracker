#!/usr/bin/env bash
# Benchmark target database (dev/local):
#   - Postgres host (from this script): localhost:5437
#   - Database: records (or auth, depending on setup)
#   - Docker Compose service: postgres-auth (ports: 5437:5432)
#   - Schemas used: auth, bench (results), public, auth
#
# Important:
#   - This script benchmarks the Docker Postgres instance for auth service, NOT the K8s postgres pod.
#   - K8s microservices connect to the same Docker DB via:
#       host.docker.internal:5437 (db=records, search_path=auth|...)
set -Euo pipefail

# Avoid libpq trying GSSAPI on localhost; it's just noise in logs
export PGGSSENCMODE=disable

usage() {
  cat <<USAGE
Usage: ${0##*/} [options]
  -p, --pod NAME           Postgres pod name (default: autodetect)
  -n, --namespace NS       Kubernetes namespace (default: off-campus-housing)
  -u, --user UUID          User UUID to benchmark (default: 0dc268d0-a86f-4e12-8d10-9db0f1b735e0)
  -d, --duration SEC       Duration per benchmark run (default: 60)
  -c, --clients LIST       Comma-separated client counts (default: based on MODE)
  -t, --threads N          Worker threads (default: 12)
  -h, --help               Show this help

Environment Variables:
  MODE                     Benchmark mode: 'quick' (default) or 'deep'
                           - quick: 8,16,24,32,48,64 clients
                           - deep:  8,16,24,32,48,64,96,128,192,256 clients
                           Extended duration (3x) automatically applied for clients >= 128

Examples:
  # Quick mode (default)
  ./scripts/run_social_pgbench_sweep.sh

  # Deep mode (high client counts)
  MODE=deep ./scripts/run_auth_pgbench_sweep.sh

  # Custom client counts
  ./scripts/run_social_pgbench_sweep.sh -c 8,16,32,64,128

  # Fast dev mode (quick iteration)
  RUN_COLD_CACHE=false GENERATE_PLOTS=false SKIP_DISK_CHECK=true \
  TRACK_IO_TIMING=off MODE=quick ./scripts/run_auth_pgbench_sweep.sh
USAGE
}

# Canonical auth DB connection (override via env if needed)
AUTH_DB_HOST="${AUTH_DB_HOST:-localhost}"
AUTH_DB_PORT="${AUTH_DB_PORT:-5437}"  # Docker Compose auth DB
AUTH_DB_USER="${AUTH_DB_USER:-postgres}"
AUTH_DB_NAME="${AUTH_DB_NAME:-records}"
AUTH_DB_PASS="${AUTH_DB_PASS:-postgres}"

NS="off-campus-housing"
POD=""
USER_UUID="0dc268d0-a86f-4e12-8d10-9db0f1b735e0"
DURATION=60
MODE="${MODE:-quick}"  # quick | deep
# Set CLIENTS based on MODE
if [[ "$MODE" == "deep" ]]; then
  CLIENTS="8,16,24,32,48,64,96,128,192,256"
else
  CLIENTS="8,16,24,32,48,64"
fi
THREADS=12
TRACK_IO_TIMING="${TRACK_IO_TIMING:-on}"
WORK_MEM_MB="${WORK_MEM_MB:-32}"
EFFECTIVE_IO_CONCURRENCY="${EFFECTIVE_IO_CONCURRENCY:-200}"
# Optional: name of a pre-created temp tablespace on tmpfs (e.g. fasttmp)
# If set, benchmarks will use this tablespace for temp files (reduces p999 spikes)
FAST_TEMP_TABLESPACE="${FAST_TEMP_TABLESPACE:-}"
RANDOM_PAGE_COST="${RANDOM_PAGE_COST:-1.1}"
CPU_INDEX_TUPLE_COST="${CPU_INDEX_TUPLE_COST:-0.0005}"
CPU_TUPLE_COST="${CPU_TUPLE_COST:-0.01}"
EFFECTIVE_CACHE_SIZE="${EFFECTIVE_CACHE_SIZE:-4GB}"
MAX_PARALLEL_WORKERS="${MAX_PARALLEL_WORKERS:-12}"
MAX_PARALLEL_WORKERS_PER_GATHER="${MAX_PARALLEL_WORKERS_PER_GATHER:-4}"
MAINTENANCE_WORK_MEM="${MAINTENANCE_WORK_MEM:-512MB}"
# Regression and diff (see scripts/PGBENCH_HARDENING.md)
RUN_DIFF_MODE="${RUN_DIFF_MODE:-false}"
BASELINE_CSV="${BASELINE_CSV:-}"
REG_THRESH_TPS_DROP="${REG_THRESH_TPS_DROP:-0.15}"
REG_THRESH_P95_INCREASE="${REG_THRESH_P95_INCREASE:-0.25}"
RUN_PLAN_DUMP="${RUN_PLAN_DUMP:-true}"
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-30000}"
LOCK_TIMEOUT="${LOCK_TIMEOUT:-10000}"
IDLE_IN_TRANSACTION_TIMEOUT="${IDLE_IN_TRANSACTION_TIMEOUT:-60000}"
DEADLOCK_TIMEOUT="${DEADLOCK_TIMEOUT:-500}"
PLAN_CACHE_MODE="${PLAN_CACHE_MODE:-force_generic_plan}"
JOIN_COLLAPSE_LIMIT="${JOIN_COLLAPSE_LIMIT:-1}"
FROM_COLLAPSE_LIMIT="${FROM_COLLAPSE_LIMIT:-1}"

PGOPTIONS_EXTRA="-c jit=off -c enable_seqscan=off -c random_page_cost=${RANDOM_PAGE_COST} -c cpu_index_tuple_cost=${CPU_INDEX_TUPLE_COST} -c cpu_tuple_cost=${CPU_TUPLE_COST} -c effective_cache_size=${EFFECTIVE_CACHE_SIZE} -c work_mem=${WORK_MEM_MB}MB -c track_io_timing=${TRACK_IO_TIMING} -c effective_io_concurrency=${EFFECTIVE_IO_CONCURRENCY} -c max_parallel_workers=${MAX_PARALLEL_WORKERS} -c max_parallel_workers_per_gather=${MAX_PARALLEL_WORKERS_PER_GATHER} -c maintenance_work_mem=${MAINTENANCE_WORK_MEM} -c synchronous_commit=off -c statement_timeout=${STATEMENT_TIMEOUT} -c lock_timeout=${LOCK_TIMEOUT} -c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT} -c deadlock_timeout=${DEADLOCK_TIMEOUT} -c plan_cache_mode=${PLAN_CACHE_MODE} -c join_collapse_limit=${JOIN_COLLAPSE_LIMIT} -c from_collapse_limit=${FROM_COLLAPSE_LIMIT} -c search_path=public,auth,pg_catalog"

# Add temp_tablespaces if FAST_TEMP_TABLESPACE is set
if [[ -n "$FAST_TEMP_TABLESPACE" ]]; then
  PGOPTIONS_EXTRA="$PGOPTIONS_EXTRA -c temp_tablespaces=$FAST_TEMP_TABLESPACE"
fi

# Enforce uniform tuning: jit=off and synchronous_commit=off must not be overridden (see PGBENCH_HARDENING.md)
enforce_critical_pgoptions() {
  local opts="$1"
  opts=$(echo "$opts" | sed -E 's/-c jit=[^ ]+//g')
  opts=$(echo "$opts" | sed -E 's/-c synchronous_commit=[^ ]+//g')
  echo "-c jit=off -c synchronous_commit=off $opts" | sed 's/  */ /g'
}
PGOPTIONS_EXTRA=$(enforce_critical_pgoptions "$PGOPTIONS_EXTRA")

# Feature toggles
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-true}"
RUN_COLD_CACHE="${RUN_COLD_CACHE:-false}"
COLD_FIRST="${COLD_FIRST:-0}"   # 1 = run cold phase then warm (pure cold first); 0 = warm then cold
GENERATE_PLOTS="${GENERATE_PLOTS:-true}"
SKIP_DISK_CHECK="${SKIP_DISK_CHECK:-false}"
DISABLE_AUTOVACUUM="${DISABLE_AUTOVACUUM:-true}"

# FAST DEV MODE: For quick iteration, use this combo:
# RUN_COLD_CACHE=false RUN_SMOKE_TESTS=false GENERATE_PLOTS=false \
# SKIP_DISK_CHECK=true DISABLE_AUTOVACUUM=false TRACK_IO_TIMING=off \
# MODE=quick ./scripts/run_social_pgbench_sweep.sh
#
# DEEP MODE: For comprehensive testing with high client counts:
# MODE=deep ./scripts/run_social_pgbench_sweep.sh
#
# This will test: 8,16,24,32,48,64,96,128,192,256 clients
# Extended duration (3x) automatically applied for clients >= 128

PHASE="warm"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NS="$2"; shift 2 ;;
    -p|--pod) POD="$2"; shift 2 ;;
    -u|--user) USER_UUID="$2"; shift 2 ;;
    -d|--duration) DURATION="$2"; shift 2 ;;
    -c|--clients) CLIENTS="$2"; shift 2 ;;
    -t|--threads) THREADS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$script_dir/.." && pwd)"

# Create log directory for this run
LOG_DIR="$REPO_ROOT/bench_logs/auth_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR"
echo "📁 Logging EXPLAINs and diagnostics to: $LOG_DIR"

# Pre-flight: disk space (align with run_pgbench_sweep.sh; see PGBENCH_HARDENING.md)
check_disk_space() {
  local host_avail host_used host_pct
  echo "🔍 Pre-flight: Checking disk space..."
  host_info=$(df -h . 2>/dev/null | tail -1 || echo "")
  if [[ -n "$host_info" ]]; then
    host_avail=$(echo "$host_info" | awk '{print $4}')
    host_used=$(echo "$host_info" | awk '{print $3}')
    host_pct=$(echo "$host_info" | awk '{print $5}' | sed 's/%//')
    echo "  Host: ${host_used} used, ${host_avail} available (${host_pct}% used)"
    if [[ "$host_pct" =~ ^[0-9]+$ ]] && [[ "$host_pct" -gt 95 ]]; then
      echo "  ❌ ERROR: Host disk is ${host_pct}% full. Cannot run benchmarks safely." >&2
      return 1
    fi
    if [[ "$host_pct" =~ ^[0-9]+$ ]] && [[ "$host_pct" -gt 90 ]]; then
      echo "  ⚠️  WARNING: Host disk is ${host_pct}% full. Risk of database failures." >&2
    fi
  fi
  echo ""
  return 0
}
if [[ "$SKIP_DISK_CHECK" != "true" ]]; then
  if ! check_disk_space; then
    echo "❌ Cannot proceed with critically low disk space. Exiting." >&2
    exit 1
  fi
else
  echo "⚠️  Skipping disk space check (SKIP_DISK_CHECK=true)"
fi

# Wait for database (align with run_pgbench_sweep.sh)
wait_for_db_ready() {
  local max_attempts=5 attempt=0 wait_interval=1
  echo "🔍 Checking database readiness (${AUTH_DB_HOST}:${AUTH_DB_PORT})..."
  if PGPASSWORD="$AUTH_DB_PASS" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ Database is ready"
    return 0
  fi
  while [[ $attempt -lt $max_attempts ]]; do
    local recovery_status
    recovery_status=$(PGPASSWORD="$AUTH_DB_PASS" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "t")
    if [[ "$recovery_status" == "f" ]]; then
      if PGPASSWORD="$AUTH_DB_PASS" psql -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" -U "$AUTH_DB_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
        echo "✅ Database is ready"
        return 0
      fi
    fi
    echo "⏳ Waiting for database... (attempt $((attempt + 1))/$max_attempts)"
    sleep "$wait_interval"
    attempt=$((attempt + 1))
  done
  echo "❌ Database did not become ready." >&2
  return 1
}
wait_for_db_ready || { echo "❌ Cannot proceed without a ready database. Exiting." >&2; exit 1; }

# Find a pod to run pgbench from
USE_LOCAL_PGBENCH=false
if [[ -z "$POD" ]]; then
  POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
fi
if [[ -z "$POD" ]]; then
  POD=$(kubectl -n "$NS" get pod --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
fi
if [[ -z "$POD" ]]; then
  if command -v pgbench >/dev/null 2>&1; then
    echo "⚠️  No pod found in namespace $NS - will run pgbench locally" >&2
    echo "   Postgres is external (Docker), connecting to ${AUTH_DB_HOST}:${AUTH_DB_PORT}" >&2
    USE_LOCAL_PGBENCH=true
  else
    echo "❌ No pod found and pgbench not installed locally" >&2
    exit 1
  fi
else
  echo "Using pod: $POD (namespace: $NS) for running pgbench"
fi

# Helper function for psql - always uses the same DSN as pgbench
psql_in_pod() {
  PGPASSWORD="$AUTH_DB_PASS" psql \
    -h "$AUTH_DB_HOST" -p "$AUTH_DB_PORT" \
    -U "$AUTH_DB_USER" -d "$AUTH_DB_NAME" \
    -X -P pager=off "$@"
}

# Force local pgbench when pgbench is available locally
if command -v pgbench >/dev/null 2>&1; then
  echo "✅ Using local pgbench (connecting to ${AUTH_DB_HOST}:${AUTH_DB_PORT})"
  USE_LOCAL_PGBENCH=true
  POD=""
fi

tmpdir=$(mktemp -d)
trap 'cd "$REPO_ROOT" 2>/dev/null || true; rm -rf "$tmpdir"; if [[ -n "${LOG_DIR:-}" ]] && [[ -d "$LOG_DIR" ]]; then find "$REPO_ROOT" -maxdepth 1 -name "auth_bench_sweep_*.csv" -type f -exec mv {} "$LOG_DIR/" \; 2>/dev/null || true; echo ""; echo "📁 All results and logs saved to: $LOG_DIR"; fi' EXIT

# Create bench schema
cat <<'SQL' > "$tmpdir/create_bench_schema.sql"
SET search_path = public, auth;
CREATE SCHEMA IF NOT EXISTS bench;
CREATE TABLE IF NOT EXISTS bench.results (
  id bigserial PRIMARY KEY,
  ts_utc timestamptz DEFAULT now() NOT NULL,
  variant text NOT NULL,
  phase text,
  clients int NOT NULL,
  threads int NOT NULL,
  duration_s int NOT NULL,
  tps numeric,
  ok_xacts bigint,
  fail_xacts bigint,
  lat_avg_ms numeric,
  lat_std_ms numeric,
  lat_est_ms numeric,
  p50_ms numeric,
  p95_ms numeric,
  p99_ms numeric,
  p999_ms numeric,
  p9999_ms numeric,
  p99999_ms numeric,
  p999999_ms numeric,
  p9999999_ms numeric,
  p100_ms numeric,
  notes text,
  git_rev text,
  git_branch text,
  host text,
  server_version text,
  track_io boolean,
  delta_blks_hit bigint,
  delta_blks_read bigint,
  delta_xact_commit bigint,
  hit_ratio_pct numeric,
  run_id text
);
ALTER TABLE bench.results ADD COLUMN IF NOT EXISTS lat_est_ms numeric;
ALTER TABLE bench.results ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE bench.results ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE bench.results ADD COLUMN IF NOT EXISTS ok_xacts bigint;
ALTER TABLE bench.results ADD COLUMN IF NOT EXISTS fail_xacts bigint;
ALTER TABLE bench.results ADD COLUMN IF NOT EXISTS p99999_ms numeric;
SQL

# Create benchmark SQL files
bench_sql_dir="$tmpdir/bench_sql"
mkdir -p "$bench_sql_dir"

# User creation benchmark
cat > "$bench_sql_dir/bench_user_create.sql" <<'EOF'
SET search_path = auth, public, pg_catalog;
INSERT INTO auth.users (email, password_hash, settings)
VALUES ('benchmark' || random()::text || '@example.com', 'hashed_password', '{}'::jsonb)
RETURNING id;
EOF

# User lookup by email benchmark (base columns; extended schema adds email_verified, etc.)
cat > "$bench_sql_dir/bench_user_lookup.sql" <<'EOF'
SET search_path = auth, public, pg_catalog;
SELECT id, email, settings, created_at
FROM auth.users
WHERE email = 'benchmark' || random()::text || '@example.com'
LIMIT 1;
EOF

# Get user by ID benchmark
cat > "$bench_sql_dir/bench_user_get.sql" <<'EOF'
SET search_path = auth, public, pg_catalog;
SELECT id, email, settings, created_at
FROM auth.users
WHERE id = :uid::uuid;
EOF

# User list benchmark
cat > "$bench_sql_dir/bench_user_list.sql" <<'EOF'
SET search_path = auth, public, pg_catalog;
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 20;
EOF

# Update user settings benchmark
cat > "$bench_sql_dir/bench_user_update.sql" <<'EOF'
SET search_path = auth, public, pg_catalog;
UPDATE auth.users
SET settings = jsonb_build_object('updated', now()::text)
WHERE id = :uid::uuid
RETURNING id;
EOF

# Session lookup benchmark (requires auth.sessions from 07-auth-schema-extended.sql)
cat > "$bench_sql_dir/bench_session_get.sql" <<'EOF'
SET search_path = auth, public, pg_catalog;
SELECT id, user_id, expires_at, created_at
FROM auth.sessions
WHERE user_id = :uid::uuid
ORDER BY created_at DESC
LIMIT 10;
EOF

# NOOP baseline
cat > "$bench_sql_dir/bench_noop.sql" <<'EOF'
SELECT 1;
EOF

echo "✅ SQL files generated"

# Verify database connection
echo "=== Verifying database connection ==="
if ! psql_in_pod -c "SELECT 1;" >/dev/null 2>&1; then
  echo "❌ Cannot connect to database at ${AUTH_DB_HOST}:${AUTH_DB_PORT}" >&2
  exit 1
fi
echo "✅ Database connection verified"

# Build variants: skip session_get if auth.sessions does not exist (apply infra/db/07-auth-schema-extended.sql to enable)
if psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions');" 2>/dev/null | grep -q 't'; then
  declare -a variants=("user_create" "user_lookup" "user_get" "user_list" "user_update" "session_get" "noop")
else
  echo "⚠️  auth.sessions not found; skipping session_get variant (apply infra/db/07-auth-schema-extended.sql to enable)"
  declare -a variants=("user_create" "user_lookup" "user_get" "user_list" "user_update" "noop")
fi

# Check if fast temp tablespace exists and is configured
if [[ -n "$FAST_TEMP_TABLESPACE" ]]; then
  echo "--- Checking fast temp tablespace: $FAST_TEMP_TABLESPACE ---"
  TABLESPACE_EXISTS=$(psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_tablespace WHERE spcname = '$FAST_TEMP_TABLESPACE');" 2>/dev/null | tr -d ' ' || echo "f")
  if [[ "$TABLESPACE_EXISTS" == "t" ]]; then
    TABLESPACE_INFO=$(psql_in_pod -tAc "SELECT pg_tablespace_location(oid) || ' (' || pg_size_pretty(pg_tablespace_size('$FAST_TEMP_TABLESPACE')) || ')' FROM pg_tablespace WHERE spcname = '$FAST_TEMP_TABLESPACE';" 2>/dev/null || echo "")
    echo "✅ Fast temp tablespace '$FAST_TEMP_TABLESPACE' exists: $TABLESPACE_INFO"
    echo "   This will reduce p999 spikes by using RAM instead of disk for temp files"
  else
    echo "⚠️  WARNING: Fast temp tablespace '$FAST_TEMP_TABLESPACE' does not exist!" >&2
    echo "   To create it, run: ./scripts/setup-fast-temp-tablespace.sh" >&2
    echo "   Or unset FAST_TEMP_TABLESPACE to use default temp location" >&2
  fi
else
  echo "--- Fast temp tablespace not configured (FAST_TEMP_TABLESPACE not set) ---"
  echo "   To enable fast temp tablespace (reduces p999 spikes), run:"
  echo "   ./scripts/setup-fast-temp-tablespace.sh"
  echo "   Then set: export FAST_TEMP_TABLESPACE=fasttmp"
fi
echo ""

# Create bench schema
psql_in_pod < "$tmpdir/create_bench_schema.sql" >/dev/null 2>&1 || true

# Create pgbench runner script
cat <<'SH' > "$tmpdir/run_pgbench.sh"
#!/usr/bin/env bash
set -Eeuo pipefail
: "${PGHOST:=localhost}"
: "${PGPORT:=5437}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

pgopts="${1:-}"
if [[ $# -ge 1 ]]; then
  shift
fi

if [[ -n "$pgopts" ]]; then
  if [[ "$pgopts" != *"search_path"* ]]; then
    export PGOPTIONS="$pgopts -c search_path=public,auth,pg_catalog"
  else
    export PGOPTIONS="$pgopts"
  fi
else
  export PGOPTIONS="-c search_path=public,auth,pg_catalog"
fi

cd /tmp
exec pgbench -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
SH

chmod +x "$tmpdir/run_pgbench.sh"

# Copy script to pod if needed
if [[ "$USE_LOCAL_PGBENCH" != "true" ]] && [[ -n "$POD" ]]; then
  kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null 2>&1 || \
  kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" >/dev/null 2>&1 || {
    echo "⚠️  Could not copy script to pod, will use local pgbench" >&2
    USE_LOCAL_PGBENCH=true
  }
  if [[ "$USE_LOCAL_PGBENCH" != "true" ]]; then
    kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true
  fi
fi

# Helper functions
percentile_idx() {
  awk -v p="$1" -v n="$2" 'BEGIN{x=p/100.0*n;i=int(x); if (x>i) i++; if (i<1) i=1; if (i>n) i=n; print i}'
}

calc_latency_metrics() {
  local lat_file="$1"
  if [[ ! -s "$lat_file" ]]; then
    echo "NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN NaN"
    return
  fi
  local sorted="$lat_file.sorted"
  sort -n "$lat_file" -o "$sorted"
  local n
  n=$(wc -l < "$lat_file")
  local avg std
  read -r avg std < <(awk '{s+=$1; ss+=$1*$1} END {if (NR>0) {m=s/NR; v=(ss/NR)-(m*m); if (v<0) v=0; sd=sqrt(v); printf "%.6f %.6f", m, sd}}' "$lat_file")
  local i50 i95 i99 i999 i9999 i99999 i999999 i9999999
  i50=$(percentile_idx 50 "$n")
  i95=$(percentile_idx 95 "$n")
  i99=$(percentile_idx 99 "$n")
  i999=$(percentile_idx 99.9 "$n")
  i9999=$(percentile_idx 99.99 "$n")
  i99999=$(percentile_idx 99.999 "$n")
  i999999=$(percentile_idx 99.9999 "$n")
  i9999999=$(percentile_idx 99.99999 "$n")
  local p50 p95 p99 p999 p9999 p99999 p999999 p9999999 max
  p50=$(sed -n "${i50}p" "$sorted")
  p95=$(sed -n "${i95}p" "$sorted")
  p99=$(sed -n "${i99}p" "$sorted")
  p999=$(sed -n "${i999}p" "$sorted")
  p9999=$(sed -n "${i9999}p" "$sorted")
  p99999=$(sed -n "${i99999}p" "$sorted")
  p999999=$(sed -n "${i999999}p" "$sorted")
  p9999999=$(sed -n "${i9999999}p" "$sorted")
  max=$(tail -n1 "$sorted")
  echo "$avg $std $p50 $p95 $p99 $p999 $p9999 $p99999 $p999999 $p9999999 $max"
}

read_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
SELECT blks_hit, blks_read, xact_commit, tup_returned, tup_fetched
FROM pg_stat_database
WHERE datname = current_database();
SQL
}

git_rev=$(git rev-parse --short HEAD 2>/dev/null || echo na)
git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo na)

# Initialize CSV file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_ID="auth_run_${TIMESTAMP}"
echo "RUN_ID=${RUN_ID}"
results_csv="$tmpdir/auth_bench_sweep_${TIMESTAMP}.csv"
echo "ts_utc,variant,clients,threads,duration_s,tps,ok_xacts,fail_xacts,lat_avg_ms,lat_std_ms,lat_est_ms,p50_ms,p95_ms,p99_ms,p999_ms,p9999_ms,p99999_ms,p999999_ms,p9999999_ms,p100_ms,git_rev,git_branch,host,server_version,track_io,delta_blks_hit,delta_blks_read,delta_xact_commit,hit_ratio_pct,phase,notes" > "$results_csv"
echo "📊 CSV results file: $results_csv"

echo "--- Running sweep"
IFS=',' read -r -a client_array <<< "$CLIENTS"
echo "Running with client counts: ${client_array[*]}"

run_variant() {
  local variant="$1" sql_file="$2" clients="$3"
  local wd
  wd=$(mktemp -d)
  pushd "$wd" >/dev/null
  trap 'cd "$REPO_ROOT" 2>/dev/null || true; popd >/dev/null 2>&1 || true; [[ -n "${wd:-}" ]] && rm -rf "${wd:-}"' RETURN

  if [[ "$DISABLE_AUTOVACUUM" == "true" ]]; then
    psql_in_pod <<'SQL' >/dev/null 2>&1 || true
ALTER TABLE auth.users SET (autovacuum_enabled = false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions') THEN
    ALTER TABLE auth.sessions SET (autovacuum_enabled = false);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'passkeys') THEN
    ALTER TABLE auth.passkeys SET (autovacuum_enabled = false);
  END IF;
END $$;
SQL
  fi

  local metrics_before
  read -r metrics_before <<< "$(read_metrics)"

  local actual_threads="$THREADS"
  local duration="$DURATION"
  if (( clients >= 128 )); then
    duration=$(( DURATION * 3 ))
    echo "⚠️  High concurrency ($clients clients): using extended duration ${duration}s"
  fi

  if [[ "$USE_LOCAL_PGBENCH" == "true" ]]; then
    rm -f "$wd"/pgbench_log.* 2>/dev/null || true
    PGHOST="$AUTH_DB_HOST" PGPORT="$AUTH_DB_PORT" PGUSER="$AUTH_DB_USER" PGDATABASE="$AUTH_DB_NAME" PGPASSWORD="$AUTH_DB_PASS" \
    PGOPTIONS="$PGOPTIONS_EXTRA -c search_path=public,auth,pg_catalog" \
    pgbench \
      -n -M prepared \
      -P 5 --progress-timestamp \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" \
      -l -f "$bench_sql_dir/$sql_file" | tee "$wd/out.txt"
  else
    kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true

    kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" -c db >/dev/null 2>&1 || \
    kubectl -n "$NS" cp "$tmpdir/run_pgbench.sh" "$POD:/tmp/run_pgbench.sh" >/dev/null 2>&1 || true
    kubectl -n "$NS" exec "$POD" -c db -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- chmod +x /tmp/run_pgbench.sh >/dev/null 2>&1 || true
    kubectl -n "$NS" exec "$POD" -c db -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || \
    kubectl -n "$NS" exec "$POD" -- mkdir -p /tmp/bench_sql >/dev/null 2>&1 || true
    kubectl -n "$NS" cp "$bench_sql_dir/." "$POD:/tmp/bench_sql" -c db >/dev/null 2>&1 || \
    kubectl -n "$NS" cp "$bench_sql_dir/." "$POD:/tmp/bench_sql" >/dev/null 2>&1 || true

    kubectl -n "$NS" exec "$POD" -c db -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
      -n -M prepared \
      -P 5 --progress-timestamp \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" \
      -l -f "/tmp/bench_sql/$sql_file" | tee "$wd/out.txt" || \
    kubectl -n "$NS" exec "$POD" -- /tmp/run_pgbench.sh "$PGOPTIONS_EXTRA" \
      -n -M prepared \
      -P 5 --progress-timestamp \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" \
      -l -f "/tmp/bench_sql/$sql_file" | tee "$wd/out.txt"

    if kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && compgen -G "pgbench_log.*" >/dev/null' 2>/dev/null; then
      kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd" 2>/dev/null || \
      kubectl -n "$NS" exec "$POD" -- bash -lc 'cd /tmp && tar cf - pgbench_log.*' | tar xf - -C "$wd" 2>/dev/null || true
      kubectl -n "$NS" exec "$POD" -c db -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || \
      kubectl -n "$NS" exec "$POD" -- bash -lc 'rm -f /tmp/pgbench_log.*' >/dev/null 2>&1 || true
    fi
  fi

  local rc=${PIPESTATUS[0]}

  if [[ "$DISABLE_AUTOVACUUM" == "true" ]]; then
    psql_in_pod <<'SQL' >/dev/null 2>&1 || true
    ALTER TABLE auth.users SET (autovacuum_enabled = true);
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions') THEN
        ALTER TABLE auth.sessions SET (autovacuum_enabled = true);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'passkeys') THEN
        ALTER TABLE auth.passkeys SET (autovacuum_enabled = true);
      END IF;
    END $$;
SQL
  fi

  if [[ $rc -ne 0 ]]; then
    echo "pgbench failed for $variant (clients=$clients)" >&2
    popd >/dev/null 2>&1 || true
    rm -rf "$wd"
    return $rc
  fi

  local tps ok fail avg std p50 p95 p99 p999 p9999 p99999 p999999 p9999999 pmax lat_est_ms
  tps=$(sed -n "s/^tps = \([0-9.][0-9.]*\) .*/\1/p" "$wd/out.txt" | tail -n1)
  ok=$(sed -n 's/^number of transactions actually processed: \([0-9][0-9]*\).*/\1/p' "$wd/out.txt" | tail -n1)
  [[ -z "$ok" ]] && ok=0
  fail=$(sed -n 's/^number of failed transactions: \([0-9][0-9]*\).*/\1/p' "$wd/out.txt" | tail -n1)
  [[ -z "$fail" ]] && fail=0

  lat_est_ms=$(awk -v c="$clients" -v t="$tps" 'BEGIN{
    if (t > 0) printf "%.3f", 1000.0 * c / t;
    else print "";
  }')

  if ls "$wd"/pgbench_log.* >/dev/null 2>&1; then
    summary_avg_ms=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    lat_col=""
    if [[ -n "$summary_avg_ms" ]]; then
      awk -v target="$summary_avg_ms" '
        {
          for (i = 1; i <= NF; i++) {
            if ($i ~ /^[0-9]+$/) {
              sum[i] += $i;
              cnt[i] += 1;
            }
          }
        }
        END {
          best_i   = -1;
          best_err = 1e99;
          for (i in sum) {
            if (cnt[i] == 0) continue;
            avg_ms = (sum[i] / cnt[i]) / 1000.0;
            if (target <= 0) continue;
            err = avg_ms - target;
            if (err < 0) err = -err;
            if (err < best_err) {
              best_err = err;
              best_i   = i;
            }
          }
          if (best_i > 0)
            print best_i;
        }
      ' "$wd"/pgbench_log.* > "$wd/lat_col.txt" 2>/dev/null || true
      lat_col=$(cat "$wd/lat_col.txt" 2>/dev/null || echo "")
    fi

    if [[ -n "$lat_col" ]]; then
      awk -v col="$lat_col" '
        {
          if (NF < col) next;
          v = $col + 0;
          if (v <= 0) next;
          ms = v / 1000.0;
          if (ms < 60000)
            printf("%.3f\n", ms);
        }
      ' "$wd"/pgbench_log.* > "$wd/lat.txt" 2>/dev/null || true
    fi

    if [[ -s "$wd/lat.txt" ]]; then
      read -r avg std p50 p95 p99 p999 p9999 p99999 p999999 p9999999 pmax < <(calc_latency_metrics "$wd/lat.txt")
      [[ -z "$avg"   || "$avg"   == "NaN" ]] && avg=""
      [[ -z "$std"   || "$std"   == "NaN" ]] && std=""
      [[ -z "$p50"   || "$p50"   == "NaN" ]] && p50=""
      [[ -z "$p95"   || "$p95"   == "NaN" ]] && p95=""
      [[ -z "$p99"   || "$p99"   == "NaN" ]] && p99=""
      [[ -z "$p999"  || "$p999"  == "NaN" ]] && p999=""
      [[ -z "$p9999" || "$p9999" == "NaN" ]] && p9999=""
      [[ -z "$p99999" || "$p99999" == "NaN" ]] && p99999=""
      [[ -z "$p999999" || "$p999999" == "NaN" ]] && p999999=""
      [[ -z "$p9999999" || "$p9999999" == "NaN" ]] && p9999999=""
      [[ -z "$pmax"  || "$pmax"  == "NaN" ]] && pmax=""
    else
      avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
      std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
      p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; p999999=""; p9999999=""; pmax=""
    fi
  else
    avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; p999999=""; p9999999=""; pmax=""
  fi

  local metrics_after
  read -r metrics_after <<< "$(read_metrics)"

  IFS=' ' read -r blks_hit_before blks_read_before xact_before tup_ret_before tup_fetch_before <<< "$metrics_before"
  IFS=' ' read -r blks_hit_after blks_read_after xact_after tup_ret_after tup_fetch_after <<< "$metrics_after"

  local d_blks_hit=$((blks_hit_after - blks_hit_before))
  local d_blks_read=$((blks_read_after - blks_read_before))
  local d_xact=$((xact_after - xact_before))
  local hit_ratio
  hit_ratio=$(awk -v h="$d_blks_hit" -v r="$d_blks_read" 'BEGIN{t=h+r; if (t>0) printf "%.3f", 100.0*h/t; else printf ""}')

  local ts
  ts=$(date -u +%FT%TZ)
  local host
  host="$POD"
  local track_io
  track_io=$(psql_in_pod -At -c "SHOW track_io_timing" | tr 'A-Z' 'a-z')
  track_io=$([[ "$track_io" == "on" ]] && echo true || echo false)

  local notes_str="rev=$git_rev branch=$git_branch host=$host variant=$variant phase=$PHASE"

  echo "$ts,$variant,$clients,$actual_threads,$duration,$tps,$ok,$fail,$avg,$std,$lat_est_ms,$p50,$p95,$p99,$p999,$p9999,$p99999,$p999999,$p9999999,$pmax,$git_rev,$git_branch,$host,$(psql_in_pod -At -c 'SHOW server_version'),$track_io,$d_blks_hit,$d_blks_read,$d_xact,$hit_ratio,$PHASE,$notes_str" >> "$results_csv"

  psql_in_pod -v ON_ERROR_STOP=1 \
    -v variant="$variant" -v clients="$clients" -v threads="$actual_threads" \
    -v duration="$duration" -v tps="$tps" -v ok="$ok" \
    -v fail="$fail" -v avg="$avg" -v std="$std" \
    -v lat_est="$lat_est_ms" -v p50="$p50" -v p95="$p95" -v p99="$p99" -v p999="$p999" \
    -v p9999="$p9999" -v p99999="$p99999" -v p999999="$p999999" -v p9999999="$p9999999" -v p100="$pmax" \
    -v phase="$PHASE" -v notes="$notes_str" \
    -v git_rev="$git_rev" -v git_branch="$git_branch" -v host="$host" \
    -v server_version="$(psql_in_pod -At -c 'SHOW server_version')" \
    -v track_io="$track_io" -v dH="$d_blks_hit" -v dR="$d_blks_read" \
    -v dXC="$d_xact" -v hit_ratio="$hit_ratio" -v run_id="$RUN_ID" \
    -f - <<'EOSQL'
      SET search_path = bench, public, auth;
      INSERT INTO bench.results(
        variant, phase, clients, threads, duration_s,
        tps, ok_xacts, fail_xacts,
        lat_avg_ms, lat_std_ms, lat_est_ms,
        p50_ms, p95_ms, p99_ms, p999_ms, p9999_ms, p99999_ms, p999999_ms, p9999999_ms, p100_ms,
        notes, git_rev, git_branch, host, server_version, track_io,
        delta_blks_hit, delta_blks_read, delta_xact_commit, hit_ratio_pct, run_id
      ) VALUES (
        :'variant', :'phase', :'clients'::int, :'threads'::int, :'duration'::int,
        NULLIF(:'tps','')::numeric, NULLIF(:'ok','')::bigint, NULLIF(:'fail','')::bigint,
        NULLIF(NULLIF(:'avg','NaN'),'')::numeric, NULLIF(NULLIF(:'std','NaN'),'')::numeric,
        NULLIF(NULLIF(:'lat_est','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p50','NaN'),'')::numeric, NULLIF(NULLIF(:'p95','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p99','NaN'),'')::numeric, NULLIF(NULLIF(:'p999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p9999','NaN'),'')::numeric, NULLIF(NULLIF(:'p99999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p999999','NaN'),'')::numeric, NULLIF(NULLIF(:'p9999999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p100','NaN'),'')::numeric,
        :'notes', :'git_rev', :'git_branch', :'host', :'server_version', :'track_io'::boolean,
        NULLIF(:'dH','')::bigint, NULLIF(:'dR','')::bigint, NULLIF(:'dXC','')::bigint,
        NULLIF(:'hit_ratio','')::numeric, :'run_id'
      );
EOSQL

  popd >/dev/null 2>&1 || true
  rm -rf "$wd"
}

# Helper: Cold cache reset (DB-level)
cold_cache_reset() {
  echo "--- Cold cache reset (DB-level) ---"
  
  # Check if database is in recovery mode before attempting checkpoint
  local recovery_status
  recovery_status=$(psql_in_pod -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "t")
  
  if [[ "$recovery_status" == "t" ]]; then
    echo "⚠️  WARNING: Database is in recovery mode, skipping cold cache reset" >&2
    echo "   This will affect cold phase results. Waiting for recovery to complete..." >&2
    sleep 5
    return 1
  fi
  
  # Check Docker container disk space before checkpoint
  local pg_container
  pg_container=$(docker ps --filter "name=postgres" --filter "publish=5437" --format "{{.Names}}" | head -1)
  if [[ -n "$pg_container" ]]; then
    local container_disk_pct
    container_disk_pct=$(docker exec "$pg_container" df -h /var/lib/postgresql/data 2>/dev/null | tail -1 | awk '{print $5}' | sed 's/%//' || echo "0")
    if [[ "$container_disk_pct" -gt 95 ]]; then
      echo "⚠️  WARNING: Docker container disk is ${container_disk_pct}% full, checkpoint may fail" >&2
      echo "   Consider cleaning up Docker volumes or increasing disk space" >&2
    fi
  fi
  
  if ! psql_in_pod <<'SQL' >/dev/null 2>&1; then
CHECKPOINT;
DISCARD ALL;
-- Reset stats so deltas are per-phase
SELECT pg_stat_reset();
SQL
    echo "⚠️  Cold cache reset failed (database may be in recovery or out of disk space)" >&2
    return 1
  else
    echo "✅ Cold cache reset completed"
  fi
  if [[ "${REAL_COLD_CACHE:-0}" == "1" ]]; then
    echo "   Evicting working set (REAL_COLD_CACHE=1)..."
    psql_in_pod -tA -c "SELECT count(*) FROM auth.users;" >/dev/null 2>&1 || true
    sleep 1
  fi
  sleep 2
}

# Variants set above (may exclude session_get if auth.sessions missing)

run_phase_block() {
  local phase=$1
  local clients=$2
  PHASE="$phase"
  echo ">> ${phase} phase (clients=$clients)"
  if [[ "$phase" == "cold" ]]; then cold_cache_reset; fi
  for variant in "${variants[@]}"; do
    variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
    echo "== ${variant_label}, clients=$clients, phase=$PHASE =="
    case "$variant" in
      user_create) sql_file="bench_user_create.sql" ;;
      user_lookup) sql_file="bench_user_lookup.sql" ;;
      user_get) sql_file="bench_user_get.sql" ;;
      user_list) sql_file="bench_user_list.sql" ;;
      user_update) sql_file="bench_user_update.sql" ;;
      session_get) sql_file="bench_session_get.sql" ;;
      noop) sql_file="bench_noop.sql" ;;
      *) sql_file="bench_${variant}.sql" ;;
    esac
    run_variant "$variant" "$sql_file" "$clients"
    echo
  done
}

for clients in "${client_array[@]}"; do
  echo "=== CLIENTS = $clients ==="
  if [[ "${COLD_FIRST:-0}" == "1" ]] && [[ "$RUN_COLD_CACHE" == "true" ]]; then
    run_phase_block "cold" "$clients"
    run_phase_block "warm" "$clients"
  else
    run_phase_block "warm" "$clients"
    if [[ "$RUN_COLD_CACHE" == "true" ]]; then
      run_phase_block "cold" "$clients"
    fi
  fi
done

# Copy CSV to repo root
output_dir="$REPO_ROOT"
if [[ ! -d "$output_dir" ]]; then
  output_dir="$(pwd)"
fi
cp -f "$results_csv" "$output_dir/auth_bench_sweep_${TIMESTAMP}.csv" 2>/dev/null || {
  echo "⚠️  Failed to copy CSV to $output_dir/auth_bench_sweep_${TIMESTAMP}.csv" >&2
}
cp -f "$results_csv" "$output_dir/auth_bench_sweep.csv" 2>/dev/null || {
  echo "⚠️  Failed to copy CSV to $output_dir/auth_bench_sweep.csv" >&2
}

echo "✅ Wrote $output_dir/auth_bench_sweep_${TIMESTAMP}.csv"
echo "✅ Wrote $output_dir/auth_bench_sweep.csv"
echo ""

# Regression diff vs baseline (align with run_pgbench_sweep.sh; see PGBENCH_HARDENING.md)
if [[ "$RUN_DIFF_MODE" == "true" && -n "$BASELINE_CSV" && -f "$BASELINE_CSV" ]] && command -v python3 >/dev/null 2>&1; then
  echo "--- Running regression diff vs baseline: $BASELINE_CSV ---"
  current_path="$output_dir/auth_bench_sweep_${TIMESTAMP}.csv"
  python3 <<PY
import pandas as pd
from pathlib import Path
import sys
baseline_path = Path("${BASELINE_CSV}")
current_path = Path("${current_path}")
try:
    base = pd.read_csv(baseline_path)
    cur = pd.read_csv(current_path)
    base = base[base["tps"].notnull()]
    cur = cur[cur["tps"].notnull()]
    def best_by_variant_clients(df):
        df = df.sort_values("tps", ascending=False)
        return df.drop_duplicates(["variant", "clients"])
    base_best = best_by_variant_clients(base)
    cur_best = best_by_variant_clients(cur)
    merged = cur_best.merge(base_best, on=["variant", "clients"], suffixes=("_cur", "_base"))
    if merged.empty:
        print("No overlapping (variant,clients) between baseline and current; skipping diff.")
    else:
        tps_thresh = float("${REG_THRESH_TPS_DROP}")
        p95_thresh = float("${REG_THRESH_P95_INCREASE}")
        for _, row in merged.iterrows():
            tps_base = row.get("tps_base", 0)
            tps_cur = row.get("tps_cur", 0)
            p95_base = row.get("p95_ms_base", float("nan"))
            p95_cur = row.get("p95_ms_cur", float("nan"))
            tps_delta = (tps_cur - tps_base) / tps_base if tps_base > 0 else 0.0
            p95_delta = (p95_cur - p95_base) / p95_base if (pd.notna(p95_base) and p95_base > 0 and pd.notna(p95_cur)) else 0.0
            regression = (tps_delta < -tps_thresh) or (p95_delta > p95_thresh)
            if regression:
                print(f"REGRESSION: {row['variant']} @ {int(row['clients'])} clients (tps: {tps_base:.1f} -> {tps_cur:.1f}, p95: {p95_base} -> {p95_cur})")
except Exception as e:
    print(f"Diff failed: {e}", file=sys.stderr)
    sys.exit(1)
PY
else
  [[ "$RUN_DIFF_MODE" == "true" ]] && echo "--- Diff-mode requested but BASELINE_CSV missing or python3 not available ---"
fi

echo "📊 Peak Performance Summary (this run: $RUN_ID)"
for variant in "${variants[@]}"; do
  peak=$(psql_in_pod -v run_id="$RUN_ID" -tAc "SELECT clients, tps, lat_est_ms FROM bench.results WHERE variant = '$variant' AND tps IS NOT NULL AND run_id = :'run_id' ORDER BY tps DESC LIMIT 1;" 2>/dev/null || echo "")
  if [[ -n "$peak" ]]; then
    IFS='|' read -r peak_clients peak_tps peak_lat <<< "$peak"
    echo "Peak $variant: ${peak_tps} TPS @ ${peak_clients} clients (lat_est: ${peak_lat} ms)"
  fi
done
echo ""
echo "--- Tuning suggestions (see scripts/PGBENCH_HARDENING.md) ---"
echo "  Regression: RUN_DIFF_MODE=true BASELINE_CSV=<path>; EXPLAIN ANALYZE: RUN_PLAN_DUMP=true"
echo "  Reference: run_pgbench_sweep.sh (records 5433); scale plan in PGBENCH_HARDENING.md"
echo ""

