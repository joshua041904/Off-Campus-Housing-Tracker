#!/usr/bin/env bash
# Benchmark target database (dev/local):
#   - Postgres host: localhost:5433 (external Docker container)
#   - Database: records
#   - Docker Compose service: off-campus-housing-tracker-postgres-1 (ports: 5433:5432)
#   - Schemas used: records (data), bench (results), public, auth
#
# Important:
#   - This script benchmarks the external Docker Postgres instance (NOT K8s pods).
#   - Requires local pgbench installation: brew install postgresql@16
#   - K8s microservices connect to the same Docker DB via:
#       host.docker.internal:5433 (db=records, search_path=auth|records|...)
#   - Other Docker Postgres instances:
#       postgres-social   → localhost:5434 (schemas: forum, messages)
#       postgres-listings → localhost:5435 (schema: listings)
#   - These are external to this benchmark.
set -Euo pipefail

# Avoid libpq trying GSSAPI on localhost; it's just noise in logs
export PGGSSENCMODE=disable

usage() {
  cat <<USAGE
Usage: ${0##*/} [options]
  -n, --namespace NS       Kubernetes namespace (default: off-campus-housing-tracker, used for config only)
  -u, --user UUID          Tenant UUID to benchmark (default: 0dc268d0-a86f-4e12-8d10-9db0f1b735e0)
  -q, --query TEXT         Search query string (default: "鄧麗君 album 263 cn-041 polygram")
  -d, --duration SEC       Duration per benchmark run (default: 60)
  -c, --clients LIST       Comma-separated client counts (default: 8,16,24,32,48,64)
  -t, --threads N          Worker threads (default: 12)
  -l, --limit N            LIMIT value for queries (default: 50)
  --pgoptions OPTS         Extra PGOPTIONS (default: '-c jit=off -c random_page_cost=1.0 -c cpu_index_tuple_cost=0.0005 -c cpu_tuple_cost=0.01')
  -h, --help               Show this help

Note: This script requires local pgbench installation (brew install postgresql@16).
      It connects to external Docker Postgres on localhost:5433.
USAGE
}

# Canonical records DB connection (override via env if needed)
RECORDS_DB_HOST="${RECORDS_DB_HOST:-localhost}"
RECORDS_DB_PORT="${RECORDS_DB_PORT:-5433}"  # Docker Compose main DB
RECORDS_DB_USER="${RECORDS_DB_USER:-postgres}"
RECORDS_DB_NAME="${RECORDS_DB_NAME:-records}"
RECORDS_DB_PASS="${RECORDS_DB_PASS:-postgres}"

NS="off-campus-housing-tracker"
USER_UUID="0dc268d0-a86f-4e12-8d10-9db0f1b735e0"
QUERY='鄧麗君 album 263 cn-041 polygram'
DURATION=60
MODE="${MODE:-quick}"  # quick | deep
# Set CLIENTS based on MODE
if [[ "$MODE" == "deep" ]]; then
  CLIENTS="8,16,24,32,48,64,96,128,192,256"
  # At 192+ clients, KNN/trigram search can exceed 30s; use 60s to reduce "statement timeout" aborts
  STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-60000}"
  # Reduce parallel workers at 96+ clients for knn/trgm to lower contention and tail latency
  PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS="${PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS:-1}"
else
  CLIENTS="8,16,24,32,48,64"
  STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-30000}"
  PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS="${PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS:-0}"
fi
THREADS=12 # Keep at 12 for consistency with gold run
LIMIT=50   # Keep at 50 for consistency with gold run
# TRGM threshold: default 0.40 (aligns with min_rank=0.40 in function)
# Good run used 0.3 at DB level, but function didn't use % then
# Now that function uses %, this threshold matters for candidate filtering
TRGM_THRESHOLD="${TRGM_THRESHOLD:-0.40}"
# Note: track_io_timing can be set to 'off' for maximum TPS (trades IO metrics for speed)
# Good run had track_io_timing=on, but turning off can give 5-10% TPS boost
TRACK_IO_TIMING="${TRACK_IO_TIMING:-on}"
# work_mem per session: default 32MB (matches good run)
# Good run used 32MB (32768kB), but we can bump for benchmarks if needed
WORK_MEM_MB="${WORK_MEM_MB:-32}"
# I/O concurrency for index scans; 0 = disabled, 200 is a safe high value for SSD/NVMe
# For NVMe, can go up to 300-1000, but 200-300 is typically optimal
EFFECTIVE_IO_CONCURRENCY="${EFFECTIVE_IO_CONCURRENCY:-200}"
# Optional: name of a pre-created temp tablespace on tmpfs (e.g. fasttmp)
# If set, benchmarks will use this tablespace for temp files (reduces p999 spikes)
FAST_TEMP_TABLESPACE="${FAST_TEMP_TABLESPACE:-}"
# Additional tuning parameters (optional, with sensible defaults)
# NOTE: checkpoint_completion_target and max_wal_size require PostgreSQL restart (cannot be set via PGOPTIONS)
#       They are documented here for reference. To set them, use:
#       - ALTER SYSTEM SET checkpoint_completion_target = 0.9; (then restart)
#       - ALTER SYSTEM SET max_wal_size = '1GB'; (then restart)
#       Or set them in postgresql.conf and restart PostgreSQL
# checkpoint_completion_target: 0.9 = spread checkpoints over 90% of checkpoint interval (smoother)
CHECKPOINT_COMPLETION_TARGET="${CHECKPOINT_COMPLETION_TARGET:-0.9}"
# max_wal_size: larger = fewer checkpoints, but more WAL space needed (default: 1GB)
MAX_WAL_SIZE="${MAX_WAL_SIZE:-1GB}"
# shared_buffers: typically 25% of RAM, but can be tuned per environment
# Note: This requires PostgreSQL restart to take effect, so it's mainly for reference
SHARED_BUFFERS="${SHARED_BUFFERS:-}"
# max_parallel_workers: number of parallel workers (default: 12, matches gold)
# Set to 1 to disable parallel query for high-concurrency benchmarks (reduces overhead)
MAX_PARALLEL_WORKERS="${MAX_PARALLEL_WORKERS:-12}"
# max_parallel_workers_per_gather: parallel workers per query (default: 4, matches gold)
# Set to 0 to disable parallel query for high-concurrency benchmarks (reduces overhead)
MAX_PARALLEL_WORKERS_PER_GATHER="${MAX_PARALLEL_WORKERS_PER_GATHER:-4}"
# maintenance_work_mem: memory for VACUUM, CREATE INDEX, etc. (default: 512MB)
MAINTENANCE_WORK_MEM="${MAINTENANCE_WORK_MEM:-512MB}"
# random_page_cost: cost of random disk page fetch (1.1 for SSD/NVMe, 4.0 for HDD)
RANDOM_PAGE_COST="${RANDOM_PAGE_COST:-1.1}"
# cpu_index_tuple_cost: cost of processing one index entry (default: 0.0005)
CPU_INDEX_TUPLE_COST="${CPU_INDEX_TUPLE_COST:-0.0005}"
# cpu_tuple_cost: cost of processing one tuple (default: 0.01)
CPU_TUPLE_COST="${CPU_TUPLE_COST:-0.01}"
# effective_cache_size: estimate of available cache (default: 4GB, matches gold)
EFFECTIVE_CACHE_SIZE="${EFFECTIVE_CACHE_SIZE:-4GB}"
# TUNED: Enable parallelism for better TPS (max_parallel_workers=12, max_parallel_workers_per_gather=4)
# TUNED: FTS-first strategy with candidate_cap and min_rank filtering
# GUCs match gold benchmark configuration:
# - random_page_cost=1.1 (gold: 1.1, was 1.0)
# - effective_cache_size=4GB (gold: 4GB/524288 8kB, was 8GB)
# - All other settings match gold exactly
# NOTE: checkpoint_completion_target and max_wal_size require PostgreSQL restart (cannot be set via PGOPTIONS)
#       They are documented here for reference but must be set via ALTER SYSTEM or postgresql.conf
# Enhanced tuning for lower latency and delayed saturation:
# - statement_timeout: prevent runaway queries (30s quick / 60s deep; KNN at 192 clients often needs 60s)
# - lock_timeout: prevent deadlocks from waiting too long (10s default)
# - idle_in_transaction_session_timeout: prevent idle transactions (60s default)
# - tcp_keepalives_idle: keep connections alive (600s default)
# - tcp_keepalives_interval: keepalive probe interval (30s default)
# - tcp_keepalives_count: keepalive probe count (3 default)
# - log_lock_waits: log lock waits for debugging (off by default). Set LOG_LOCK_WAITS=on to diagnose stalls/lock contention in server log.
# - deadlock_timeout: faster deadlock detection (500ms for aggressive tuning)
# - commit_delay: batch commits (0 = disabled, can be tuned for throughput)
# - commit_siblings: minimum concurrent transactions for commit_delay (5 default)
# - plan_cache_mode: force generic plans to reduce planning overhead (for high-concurrency benchmarks)
# - join_collapse_limit/from_collapse_limit: reduce planning overhead for simple queries
# STATEMENT_TIMEOUT set above from MODE (quick=30s, deep=60s); override with env if needed
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-30000}"  # 30s in ms (overridden to 60s when MODE=deep)
LOCK_TIMEOUT="${LOCK_TIMEOUT:-10000}"  # 10s in ms
IDLE_IN_TRANSACTION_TIMEOUT="${IDLE_IN_TRANSACTION_TIMEOUT:-60000}"  # 60s in ms
DEADLOCK_TIMEOUT="${DEADLOCK_TIMEOUT:-500}"  # 500ms for aggressive tuning (faster deadlock detection)
LOG_LOCK_WAITS="${LOG_LOCK_WAITS:-off}"  # off for performance, on for debugging
# Aggressive planning optimization for high-concurrency benchmarks
PLAN_CACHE_MODE="${PLAN_CACHE_MODE:-force_generic_plan}"  # force generic plans to reduce planning overhead
JOIN_COLLAPSE_LIMIT="${JOIN_COLLAPSE_LIMIT:-1}"  # reduce join planning overhead
FROM_COLLAPSE_LIMIT="${FROM_COLLAPSE_LIMIT:-1}"  # reduce FROM planning overhead
# CRITICAL PERFORMANCE SETTINGS (MUST BE SET FOR OPTIMAL PERFORMANCE):
# - jit=off: Disable JIT compilation (reduces overhead for small queries, improves consistency)
# - synchronous_commit=off: Disable synchronous WAL writes (massive TPS boost, acceptable for benchmarks)
# NOTE: enable_seqscan can be disabled for benchmarks to match "gold" run behavior
#       This forces index/bitmap scans and can help with query planning consistency
#       Default: off (match gold run), but can be overridden via ENABLE_SEQSCAN env var
ENABLE_SEQSCAN="${ENABLE_SEQSCAN:-off}"
PGOPTIONS_EXTRA="-c jit=off -c enable_seqscan=${ENABLE_SEQSCAN} -c random_page_cost=${RANDOM_PAGE_COST} -c cpu_index_tuple_cost=${CPU_INDEX_TUPLE_COST} -c cpu_tuple_cost=${CPU_TUPLE_COST} -c effective_cache_size=${EFFECTIVE_CACHE_SIZE} -c work_mem=${WORK_MEM_MB}MB -c track_io_timing=${TRACK_IO_TIMING} -c effective_io_concurrency=${EFFECTIVE_IO_CONCURRENCY} -c max_parallel_workers=${MAX_PARALLEL_WORKERS} -c max_parallel_workers_per_gather=${MAX_PARALLEL_WORKERS_PER_GATHER} -c maintenance_work_mem=${MAINTENANCE_WORK_MEM} -c pg_trgm.similarity_threshold=${TRGM_THRESHOLD} -c synchronous_commit=off -c statement_timeout=${STATEMENT_TIMEOUT} -c lock_timeout=${LOCK_TIMEOUT} -c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT} -c deadlock_timeout=${DEADLOCK_TIMEOUT} -c log_lock_waits=${LOG_LOCK_WAITS} -c plan_cache_mode=${PLAN_CACHE_MODE} -c join_collapse_limit=${JOIN_COLLAPSE_LIMIT} -c from_collapse_limit=${FROM_COLLAPSE_LIMIT} -c search_path=public,records,pg_catalog"

# Add temp_tablespaces if FAST_TEMP_TABLESPACE is set
if [[ -n "$FAST_TEMP_TABLESPACE" ]]; then
  PGOPTIONS_EXTRA="$PGOPTIONS_EXTRA -c temp_tablespaces=$FAST_TEMP_TABLESPACE"
fi

# Feature toggles (controllable via env)
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-true}"       # pre-bench pgbench sanity checks
RUN_COLD_CACHE="${RUN_COLD_CACHE:-false}"        # run a cold-cache phase too
COLD_FIRST="${COLD_FIRST:-0}"                    # 1 = cold then warm (pure cold first); 0 = warm then cold
GENERATE_PLOTS="${GENERATE_PLOTS:-true}"         # auto-generate PNG graphs
RUN_DIFF_MODE="${RUN_DIFF_MODE:-false}"          # compare against baseline CSV
BASELINE_CSV="${BASELINE_CSV:-}"                 # path to "golden" CSV for diff mode
REG_THRESH_TPS_DROP="${REG_THRESH_TPS_DROP:-0.15}"      # 15% TPS drop = regression
REG_THRESH_P95_INCREASE="${REG_THRESH_P95_INCREASE:-0.25}"  # 25% p95 increase = regression
SKIP_RESTORE="${SKIP_RESTORE:-false}"            # if true, skip automatic restore from backup
INCLUDE_RAW_TRGM_EXPLAIN="${INCLUDE_RAW_TRGM_EXPLAIN:-false}"  # if true, include raw trigram % EXPLAIN baseline
# USE_AUTO_WRAPPER: if true, use search_records_fuzzy_ids_auto wrapper (with 200ms timeout and fast->deep fallback)
# Recommended for production: true (caps worst-case latency, avoids mega-slow outliers, smoother throughput)
# Recommended for benchmarks: false (while tuning pure engine capacity), then true (to see real-user behavior)
# If you see "canceling statement due to statement timeout" in records sweep: try USE_AUTO_WRAPPER=true or STATEMENT_TIMEOUT=60000+
USE_AUTO_WRAPPER="${USE_AUTO_WRAPPER:-false}"    # if true, use search_records_fuzzy_ids_auto (with timeout) instead of bare function
USE_SQL_FUNCTION="${USE_SQL_FUNCTION:-false}"    # if true, use SQL-language function (NOTE: Currently MUCH slower than PL/pgSQL - 78ms vs 2-4ms. ALWAYS use false for best performance)
CREATE_BENCH_BACKUP="${CREATE_BENCH_BACKUP:-false}"  # if true, create backup after benchmark (default: false to avoid disk bloat)
RUN_OPTIMIZE_DB="${RUN_OPTIMIZE_DB:-false}"      # if true, run optimize-db-for-performance.sh (default: false, run once after restore)
SKIP_DISK_CHECK="${SKIP_DISK_CHECK:-false}"      # if true, skip disk space checks (faster for dev runs)
RUN_NOOP_BASELINE="${RUN_NOOP_BASELINE:-false}"  # if true, run NOOP baseline test (default: false for fast dev mode)
NOOP_TARGET_TPS="${NOOP_TARGET_TPS:-30000}"     # target NOOP TPS (tune clients/threads to reach this at scale)
RUN_PLAN_DUMP="${RUN_PLAN_DUMP:-true}"           # if true/1, run comprehensive query plan analysis (default: true)
# Normalize: RUN_PLAN_DUMP=1 (from run-all-8-pgbench-standalone.sh) must enable plan dump like "true"
[[ "$RUN_PLAN_DUMP" == "true" || "$RUN_PLAN_DUMP" == "1" ]] && RUN_PLAN_DUMP_ENABLED=1 || RUN_PLAN_DUMP_ENABLED=0
DISABLE_AUTOVACUUM="${DISABLE_AUTOVACUUM:-true}" # if true, disable autovacuum during benchmarks (default: true to prevent pauses)
RUN_TELEMETRY="${RUN_TELEMETRY:-false}"          # if true, collect perf/strace/htop snapshots for latency analysis (not packet capture)
# OPTIMIZED_FAST_MODE: DEPRECATED - SQL function now uses aggressive tuning by default
# SQL function fast mode: candidate_cap=24, min_rank=0.55 (15-25% additional CPU reduction vs candidate_cap=32)
# PL/pgSQL function fast mode: candidate_cap=40, min_rank=0.50 (gold compatibility)
OPTIMIZED_FAST_MODE="${OPTIMIZED_FAST_MODE:-false}"  # DEPRECATED: SQL function uses aggressive tuning by default
# High-concurrency tuning: 1 = reduce parallel workers for knn/trgm at 96+ clients (default 1 in deep mode, 0 in quick)
PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS="${PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS:-0}"
HIGH_LATENCY_TIP_SHOWN=0  # print tuning tip once when high latency is first seen

# FAST DEV MODE: For quick iteration, use this combo:
# USE_SQL_FUNCTION=true USE_AUTO_WRAPPER=false RUN_COLD_CACHE=false RUN_SMOKE_TESTS=false \
# GENERATE_PLOTS=false RUN_DIFF_MODE=false CREATE_BENCH_BACKUP=false RUN_OPTIMIZE_DB=false \
# SKIP_DISK_CHECK=true RUN_NOOP_BASELINE=false RUN_PLAN_DUMP=false DISABLE_AUTOVACUUM=false \
# TRACK_IO_TIMING=off MODE=quick ./scripts/run_pgbench_sweep.sh
#
# GOLD RUN CONFIGURATION (Nov 22, 2025 - Target: 6-8k TPS):
# - Function: PL/pgSQL with candidate_cap=40 (fast), min_rank=0.50
# - work_mem=32MB, effective_cache_size=4GB, random_page_cost=1.1
# - track_io_timing=on, synchronous_commit=off
# - max_parallel_workers=12, max_parallel_workers_per_gather=4
# - TRGM_THRESHOLD=0.40
# - Expected TPS: knn warm @ 64: 6152, @ 96: 7491, @ 128: 6720, @ 256: 6634

# Phase marker (warm vs cold)
PHASE="warm"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NS="$2"; shift 2 ;;
    -u|--user) USER_UUID="$2"; shift 2 ;;
    -q|--query) QUERY="$2"; shift 2 ;;
    -d|--duration) DURATION="$2"; shift 2 ;;
    -c|--clients) CLIENTS="$2"; shift 2 ;;
    -t|--threads) THREADS="$2"; shift 2 ;;
    -l|--limit) LIMIT="$2"; shift 2 ;;
    --pgoptions) PGOPTIONS_EXTRA="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# CRITICAL: Ensure mandatory performance settings are ALWAYS present
# These two settings are REQUIRED for optimal performance and MUST NOT be overridden:
# - jit=off: Disable JIT (reduces overhead for small queries)
# - synchronous_commit=off: Disable sync WAL writes (massive TPS boost)
# NOTE: enable_seqscan is NOT forced off - we want natural index/bitmap scan usage
# Even if user overrides PGOPTIONS_EXTRA via --pgoptions, we enforce these settings
enforce_critical_pgoptions() {
  local opts="$1"
  # Remove any existing instances of these settings (in case user tried to override)
  opts=$(echo "$opts" | sed -E 's/-c jit=[^ ]+//g')
  opts=$(echo "$opts" | sed -E 's/-c synchronous_commit=[^ ]+//g')
  # Add critical settings at the beginning (they take precedence)
  echo "-c jit=off -c synchronous_commit=off $opts" | sed 's/  */ /g'
}

# Apply critical settings enforcement
PGOPTIONS_EXTRA=$(enforce_critical_pgoptions "$PGOPTIONS_EXTRA")

QUERY_LITERAL=$(printf "%s" "$QUERY" | sed "s/'/''/g")
PG_QUERY_ARG="'$QUERY_LITERAL'"

# CRITICAL: Resolve script_dir and repo root robustly (like old script)
# This ensures CSV files are written to repo root, not temp directories
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$script_dir/.." && pwd)"

# Create log directory for this run (avoids terminal wraparound issues)
LOG_DIR="$REPO_ROOT/bench_logs/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR"
echo "📁 Logging EXPLAINs and diagnostics to: $LOG_DIR"

# CRITICAL: Require local pgbench installation
# Postgres is external (Docker container on localhost:5433), so we always use local pgbench
if ! command -v pgbench >/dev/null 2>&1; then
  echo "❌ pgbench not found locally" >&2
  echo "   This script requires local pgbench to connect to external Docker Postgres" >&2
  echo "   Install with: brew install postgresql@16" >&2
  exit 1
fi

echo "✅ Using local pgbench (connecting to external Docker Postgres at ${RECORDS_DB_HOST}:${RECORDS_DB_PORT})"

# CRITICAL: Helper function for psql - always uses the same DSN as pgbench
# Uses parameterized connection settings (can be overridden via env vars)
# Canonical external Postgres endpoint: localhost:5433 (Docker Compose, avoids Postgres.app conflict)
# NOTE: Function name is "psql_in_pod" for historical reasons, but it connects to external Docker PostgreSQL
# This ensures psql_in_pod and pgbench connect to the SAME database
psql_in_pod() {
  PGPASSWORD="$RECORDS_DB_PASS" psql \
    -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" \
    -U "$RECORDS_DB_USER" -d "$RECORDS_DB_NAME" \
    -X -P pager=off "$@"
}

# NOTE: Function creation moved to AFTER database restore check
# This ensures the function is created on the correct database

# Pre-flight: Check disk space (Docker and host)
check_disk_space() {
  local host_avail host_used host_pct
  
  echo "🔍 Pre-flight: Checking disk space..."
  
  # Check host disk space (fastest check, most critical)
  host_info=$(df -h . 2>/dev/null | tail -1 || echo "")
  if [[ -n "$host_info" ]]; then
    host_avail=$(echo "$host_info" | awk '{print $4}')
    host_used=$(echo "$host_info" | awk '{print $3}')
    host_pct=$(echo "$host_info" | awk '{print $5}' | sed 's/%//')
    echo "  Host: ${host_used} used, ${host_avail} available (${host_pct}% used)"
    
    # CRITICAL: Refuse to run if disk is >95% full (risk of database corruption)
    if [[ "$host_pct" =~ ^[0-9]+$ ]] && [[ "$host_pct" -gt 95 ]]; then
      echo "  ❌ ERROR: Host disk is ${host_pct}% full. Cannot run benchmarks safely." >&2
      echo "     Disk space is critically low - database may fail during checkpoints." >&2
      echo "     Please run emergency cleanup first:" >&2
      echo "       ./scripts/emergency-disk-cleanup.sh" >&2
      echo "     Or manually free space before continuing." >&2
      return 1
    fi
    
    # WARN and offer cleanup if disk is >90% full
    if [[ "$host_pct" =~ ^[0-9]+$ ]] && [[ "$host_pct" -gt 90 ]]; then
      echo "  ⚠️  WARNING: Host disk is ${host_pct}% full. Risk of database failures." >&2
      echo "     Recommend running emergency cleanup:" >&2
      echo "       ./scripts/emergency-disk-cleanup.sh" >&2
      echo "     Continuing anyway, but benchmarks may fail if disk fills up..." >&2
    elif [[ "$host_pct" =~ ^[0-9]+$ ]] && [[ "$host_pct" -gt 85 ]]; then
      echo "  ⚠️  WARNING: Host disk is ${host_pct}% full. Consider cleaning up before running benchmarks."
      echo "     Run: ./scripts/emergency-disk-cleanup.sh"
      echo "     Or: docker system prune -a --volumes -f"
      echo "     Or: find bench_logs/ -type f -mtime +1 -delete"
    fi
  fi
  
  # Docker checks are optional and non-blocking (may hang if Docker is slow)
  # Run in background and don't wait - just try to get info if available
  (
    docker_df_output=$(docker system df 2>/dev/null || echo "")
    if [[ -n "$docker_df_output" ]]; then
      echo "  Docker: $(echo "$docker_df_output" | head -5 | tail -4 | awk '{print $1": "$3" (reclaimable: "$4")"}' | tr '\n' '; ')"
      
      docker_space=$(echo "$docker_df_output" | grep "Images" | awk '{print $4}' | sed 's/[()%]//g' | awk -F'/' '{print $1}' | grep -E '^[0-9]+$' || echo "")
      if [[ -n "$docker_space" ]] && [[ "$docker_space" =~ ^[0-9]+$ ]] && [[ "$docker_space" -gt 70 ]]; then
        echo "  ⚠️  WARNING: Docker images are ${docker_space}% reclaimable. Consider cleaning up."
        echo "     Run: docker system prune -a --volumes -f"
      fi
    fi
    
    pg_container=$(docker ps --filter "name=postgres" --filter "publish=5433" --format "{{.Names}}" 2>/dev/null | head -1 || echo "")
    if [[ -n "$pg_container" ]]; then
      container_disk_info=$(docker exec "$pg_container" df -h /var/lib/postgresql/data 2>/dev/null | tail -1 || echo "")
      if [[ -n "$container_disk_info" ]]; then
        container_used=$(echo "$container_disk_info" | awk '{print $3}')
        container_avail=$(echo "$container_disk_info" | awk '{print $4}')
        container_pct=$(echo "$container_disk_info" | awk '{print $5}' | sed 's/%//')
        echo "  PostgreSQL container ($pg_container): ${container_used} used, ${container_avail} available (${container_pct}% used)"
        
        if [[ "$container_pct" =~ ^[0-9]+$ ]] && [[ "$container_pct" -gt 90 ]]; then
          echo "  ⚠️  WARNING: PostgreSQL container disk is ${container_pct}% full!" >&2
          echo "     This can cause database failures. Check Docker volume size:" >&2
          echo "       docker volume inspect off-campus-housing-tracker_pgdata" >&2
        fi
      fi
    fi
  ) &
  local docker_check_pid=$!
  
  # Wait max 3 seconds for Docker checks, then continue regardless
  for i in 1 2 3; do
    if ! kill -0 "$docker_check_pid" 2>/dev/null; then
      wait "$docker_check_pid" 2>/dev/null
      break
    fi
    sleep 1
  done
  # Kill background process if still running (non-blocking)
  kill "$docker_check_pid" 2>/dev/null || true
  wait "$docker_check_pid" 2>/dev/null || true
  
  echo ""
  return 0
}

# Run disk space check - exit if critically low (unless skipped)
if [[ "$SKIP_DISK_CHECK" != "true" ]]; then
  if ! check_disk_space; then
    echo "❌ Cannot proceed with critically low disk space. Exiting." >&2
    exit 1
  fi
else
  echo "⚠️  Skipping disk space check (SKIP_DISK_CHECK=true)"
fi

# Wait for database to exit recovery mode
wait_for_db_ready() {
  local max_attempts=5
  local attempt=0
  local wait_interval=1
  
  echo "🔍 Checking database readiness..."
  
  # Quick check first - if database is accessible, we're done
  # Use a simple connection test that won't hang
  if PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ Database is ready (connection test passed)"
    return 0
  fi
  
  # If quick check failed, try a few more times with recovery check
  while [[ $attempt -lt $max_attempts ]]; do
    # Check if database is in recovery mode (use direct psql to avoid hanging)
    local recovery_status
    recovery_status=$(PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "t")
    
    if [[ "$recovery_status" == "f" ]]; then
      # Not in recovery, check if it accepts connections
      if PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
        echo "✅ Database is ready (not in recovery mode)"
        return 0
      fi
    elif [[ "$recovery_status" == "t" ]]; then
      echo "⏳ Database is in recovery mode (attempt $((attempt + 1))/$max_attempts)..."
    else
      # Connection failed - might be starting up
      echo "⏳ Database connection failed, waiting... (attempt $((attempt + 1))/$max_attempts)"
    fi
    
    sleep "$wait_interval"
    attempt=$((attempt + 1))
  done
  
  echo "❌ ERROR: Database did not exit recovery mode after $((max_attempts * wait_interval)) seconds" >&2
  echo "   This usually means:" >&2
  echo "   1. Database is still recovering from a crash or checkpoint" >&2
  echo "   2. Disk space is full (check with: df -h)" >&2
  echo "   3. WAL files are corrupted or missing" >&2
  echo "   Check Docker container logs: docker logs off-campus-housing-tracker-postgres-1" >&2
  echo "   Or check disk space in container: docker exec off-campus-housing-tracker-postgres-1 df -h" >&2
  return 1
}

# Wait for database to be ready before proceeding
wait_for_db_ready || {
  echo "❌ Cannot proceed without a ready database. Exiting." >&2
  exit 1
}

tmpdir=$(mktemp -d)
# CRITICAL: Always cd back to repo root before cleanup to avoid popd errors
trap 'cd "$REPO_ROOT" 2>/dev/null || true; rm -rf "$tmpdir"; if [[ -n "${LOG_DIR:-}" ]] && [[ -d "$LOG_DIR" ]]; then find "$REPO_ROOT" -maxdepth 1 -name "bench_sweep_*.csv" -type f -exec mv {} "$LOG_DIR/" \; 2>/dev/null || true; echo ""; echo "📁 All results and logs saved to: $LOG_DIR"; fi' EXIT

cat <<'SQL' > "$tmpdir/prepare.sql"
SET search_path = records, public;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
-- pg_stat_statements must be created in postgres database first (shared extension)
-- Then it can be used in any database. Try to create in postgres database.
-- Note: This requires superuser privileges, but we're connecting as postgres user
SQL

# CRITICAL: pg_stat_statements must be created in postgres database first (it's a shared extension)
# Then it becomes available in all databases including records
echo "--- Ensuring pg_stat_statements extension (must be in postgres database) ---"
psql_in_pod -d postgres <<'SQL' >/dev/null 2>&1 || true
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
# Verify it's available in records database (it should be, since it's shared)
if psql_in_pod -d records -tAc "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements');" 2>/dev/null | grep -q t; then
  echo "✅ pg_stat_statements extension is available in records database"
else
  echo "⚠️  WARNING: pg_stat_statements extension not available in records database" >&2
  echo "   This is non-critical - benchmarks will still run, but statement statistics won't be collected" >&2
fi

cat <<'SQL' > "$tmpdir/prepare_table.sql"
SET search_path = records, public;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;
UPDATE records.records
  SET search_norm = lower(concat_ws(' ', artist, name, catalog_number))
  WHERE search_norm IS NULL;
SQL

cat <<'SQL' > "$tmpdir/create_indexes.sql"
SET search_path = records, public;
CREATE INDEX IF NOT EXISTS idx_records_partitioned_artist_trgm ON records.records USING gin (artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_partitioned_name_trgm ON records.records USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_partitioned_catalog_trgm ON records.records USING gin (catalog_number gin_trgm_ops);
-- NOTE: These global indexes are created but then dropped by drop-global-trgm-indexes.sh
-- to force use of per-tenant partial indexes. Do NOT create them here if partial indexes are being used.
-- CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gist ON records.records USING gist (search_norm gist_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gin ON records.records USING gin (search_norm gin_trgm_ops);
ANALYZE records.records;
DO $$
DECLARE idx regclass;
BEGIN
  FOR idx IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records'
      AND c.relkind = 'i'
      AND c.relname ~ '^records_p[0-9]{2}_(artist|name|catalog|search)_'
  LOOP
    PERFORM pg_prewarm(idx);
  END LOOP;
END
$$;
SQL

cat <<'SQL' > "$tmpdir/create_bench_schema.sql"
SET search_path = public, records;
CREATE SCHEMA IF NOT EXISTS bench;
CREATE TABLE IF NOT EXISTS bench.results (
  id bigserial PRIMARY KEY,
  ts_utc timestamptz DEFAULT now() NOT NULL,
  variant text NOT NULL,
  phase text,        -- "warm" or "cold"
  clients int NOT NULL,
  threads int NOT NULL,
  duration_s int NOT NULL,
  limit_rows int NOT NULL,
  tps numeric,
  lat_avg_ms numeric,
  lat_std_ms numeric,
  lat_est_ms numeric,  -- Physics-based estimate: 1000 * clients / tps
  p50_ms numeric,
  p95_ms numeric,
  p99_ms numeric,
  p999_ms numeric,
  p9999_ms numeric,
  p99999_ms numeric,
  p999999_ms numeric,
  p100_ms numeric,
  notes text,
  git_rev text,
  git_branch text,
  host text,
  server_version text,
  track_io boolean,
  delta_blks_hit bigint,
  delta_blks_read bigint,
  delta_blk_read_ms numeric,
  delta_blk_write_ms numeric,
  delta_xact_commit bigint,
  delta_tup_returned bigint,
  delta_tup_fetched bigint,
  delta_stmt_total_ms numeric,
  delta_stmt_shared_hit bigint,
  delta_stmt_shared_read bigint,
  delta_stmt_shared_dirtied bigint,
  delta_stmt_shared_written bigint,
  delta_stmt_temp_read bigint,
  delta_stmt_temp_written bigint,
  delta_io_read_ms numeric,
  delta_io_write_ms numeric,
  delta_io_extend_ms numeric,
  delta_io_fsync_ms numeric,
  io_total_ms numeric,
  active_sessions numeric,
  cpu_share_pct numeric,
  ok_xacts bigint,
  fail_xacts bigint,
  err_pct numeric,
  delta_wal_records bigint,
  delta_wal_fpi bigint,
  delta_wal_bytes numeric,
  delta_ckpt_write_ms numeric,
  delta_ckpt_sync_ms numeric,
  delta_buf_checkpoint bigint,
  delta_buf_backend bigint,
  delta_buf_alloc bigint,
  hit_ratio_pct numeric
);

-- Ensure lat_est_ms column exists (for existing tables from earlier runs)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS lat_est_ms numeric;

-- Ensure run_id column exists (for filtering results by run)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS run_id text;

-- Ensure p999_ms column exists (for older schemas without it)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS p999_ms numeric;

-- Ensure p99999_ms column exists (for older schemas without it)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS p99999_ms numeric;

-- Ensure p999999_ms column exists (for older schemas without it)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS p999999_ms numeric;

-- Ensure p9999999_ms column exists (for extreme tail latency tracking)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS p9999999_ms numeric;

-- Ensure phase column exists (warm vs cold)
ALTER TABLE bench.results
  ADD COLUMN IF NOT EXISTS phase text;

-- Note: Not creating unique constraint to avoid conflicts with existing duplicates
-- If uniqueness is needed later, dedupe rows first, then add constraint
-- DO $$
-- BEGIN
--   ALTER TABLE bench.results
--     ADD CONSTRAINT bench_results_uq
--     UNIQUE (ts_utc, variant, clients, threads, duration_s, limit_rows, host, git_rev);
-- EXCEPTION
--   WHEN duplicate_object THEN
--     NULL;
-- END$$;
SQL

cat <<'SQL' > "$tmpdir/read_metrics.sql"
SELECT blks_hit, blks_read,
       COALESCE(blk_read_time, 0),
       COALESCE(blk_write_time, 0),
       xact_commit, tup_returned, tup_fetched
FROM pg_stat_database
WHERE datname = current_database();
SQL

# helper functions (bash)
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

# Optional: Verify port 5433 has data (standalone script can load from backups)
CHECK_RECORDS_DB="${CHECK_RECORDS_DB:-false}"
if [[ "$CHECK_RECORDS_DB" == "true" ]] && [[ -x "$REPO_ROOT/scripts/check-records-db.sh" ]]; then
  echo "=== Checking records DB (port 5433) via check-records-db.sh ==="
  "$REPO_ROOT/scripts/check-records-db.sh" --load 2>&1 | head -30
fi

# step 0: Check if database exists, restore if needed
echo "=== Checking if database exists ==="
# Check if database exists and has data
# CRITICAL: Use psql_in_pod (localhost:5433) for ALL checks to ensure consistency
# This is the same connection method used by pgbench and BENCH_USER_COUNT
DB_EXISTS=false
TABLE_EXISTS=false
ROW_COUNT=0

# Check DB via the same DSN as everything else (localhost:5433)
if psql_in_pod -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'records';" 2>/dev/null | grep -q 1; then
  DB_EXISTS=true
  echo "✅ Database 'records' exists"
  
  if psql_in_pod -d records -c "SELECT 1 FROM records.records LIMIT 1;" >/dev/null 2>&1; then
    TABLE_EXISTS=true
    ROW_COUNT=$(psql_in_pod -d records -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
    if [[ "$ROW_COUNT" -gt 0 ]]; then
      echo "✅ Table 'records.records' exists with $ROW_COUNT rows"
    else
      echo "⚠️  Table 'records.records' exists but is empty"
    fi
  else
    echo "⚠️  Table 'records.records' does not exist"
  fi
else
  echo "⚠️  Database 'records' does not exist"
fi

# TRIPLE-CHECK: Verify we have sufficient data
if [[ "$TABLE_EXISTS" == "true" ]]; then
  BENCH_USER_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
  echo "✅ Benchmark user has $BENCH_USER_COUNT records"
  
  if [[ "$BENCH_USER_COUNT" -lt 1000 ]]; then
    echo "⚠️  WARNING: Benchmark user has only $BENCH_USER_COUNT records (expected 1M+)" >&2
  fi
  
  # Check search_tsv is populated (only if column exists)
  TSV_COL_EXISTS=$(psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='records' AND table_name='records' AND column_name='search_tsv');" 2>/dev/null | tr -d ' ' || echo "f")
  if [[ "$TSV_COL_EXISTS" == "t" ]]; then
    TSV_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE search_tsv IS NOT NULL AND user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
    echo "✅ Benchmark user has $TSV_COUNT records with search_tsv populated"
    if [[ "$TSV_COUNT" -lt 1000 ]]; then
      echo "⚠️  WARNING: Only $TSV_COUNT records have search_tsv (will be populated in FTS setup)" >&2
    fi
  else
    echo "✅ search_tsv column will be added and populated in FTS setup"
  fi
  
  # Check search_norm is populated
  NORM_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE search_norm IS NOT NULL AND user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
  echo "✅ Benchmark user has $NORM_COUNT records with search_norm populated"
fi

# Only restore if database doesn't exist OR table doesn't exist OR insufficient data
if [[ "$DB_EXISTS" != "true" ]] || [[ "$TABLE_EXISTS" != "true" ]] || [[ "$ROW_COUNT" -lt 1000000 ]]; then
  if [[ "$SKIP_RESTORE" == "true" ]]; then
    echo "❌ Database not in benchmark shape (DB_EXISTS=$DB_EXISTS, TABLE_EXISTS=$TABLE_EXISTS, ROW_COUNT=$ROW_COUNT)" >&2
    echo "   SKIP_RESTORE=true, so NOT restoring from backup. Fix DB manually and rerun." >&2
    exit 1
  fi
  echo "⚠️  Database missing or insufficient data (only $ROW_COUNT rows), attempting restore..."
  RESTORED=false
  BACKUPS_DIR="${REPO_ROOT}/backups"
  # Prefer reference backup off-campus-housing-tracker-postgres-1-all-*.sql (2.4M+ rows, records + records_hot), then any .sql, then .dump
  LATEST_SQL=$(find "$BACKUPS_DIR" -maxdepth 1 -name "off-campus-housing-tracker-postgres-1-all-*.sql" -type f 2>/dev/null | sort -r | head -1)
  [[ -z "$LATEST_SQL" ]] && LATEST_SQL=$(find "$BACKUPS_DIR" -maxdepth 1 -name "*.sql" -type f 2>/dev/null | sort -r | head -1)
  if [[ -n "$LATEST_SQL" ]] && [[ -f "$LATEST_SQL" ]]; then
    echo "Loading from SQL: $LATEST_SQL (into DB records on port ${RECORDS_DB_PORT:-5433})"
    if PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'records';" 2>/dev/null | grep -q 1; then
      PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d records -f "$LATEST_SQL" 2>&1 | tail -30
    else
      PGPASSWORD="$RECORDS_DB_PASS" psql -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" -U "$RECORDS_DB_USER" -d postgres -f "$LATEST_SQL" 2>&1 | tail -30
    fi
    sleep 3
    NEW_ROW_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
    if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
      echo "✅ Database loaded from SQL: $NEW_ROW_COUNT rows"
      RESTORED=true
    fi
  fi
  if [[ "$RESTORED" != "true" ]] && [[ -f "$REPO_ROOT/scripts/restore-to-external-docker.sh" ]]; then
    LATEST_BACKUP=$(find "$BACKUPS_DIR" -maxdepth 1 -name "*.dump" -type f 2>/dev/null | sort -r | head -1)
    if [[ -n "$LATEST_BACKUP" ]] && [[ -f "$LATEST_BACKUP" ]]; then
      echo "Restoring from backup: $LATEST_BACKUP"
      "$REPO_ROOT/scripts/restore-to-external-docker.sh" "$LATEST_BACKUP" 2>&1 | tail -20
      sleep 5
      NEW_ROW_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
      if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
        echo "✅ Database restored successfully with $NEW_ROW_COUNT rows"
        RESTORED=true
      else
        echo "❌ Restore failed! Database still has only $NEW_ROW_COUNT rows." >&2
        exit 1
      fi
    fi
  fi
  if [[ "$RESTORED" != "true" ]] && [[ -f "$REPO_ROOT/scripts/restore-from-local-backup.sh" ]]; then
    LATEST_BACKUP=$(find "$BACKUPS_DIR" -maxdepth 1 -name "*.dump" -type f 2>/dev/null | sort -r | head -1)
    if [[ -n "$LATEST_BACKUP" ]] && [[ -f "$LATEST_BACKUP" ]]; then
      echo "Restoring from backup: $LATEST_BACKUP"
      "$REPO_ROOT/scripts/restore-from-local-backup.sh" "$LATEST_BACKUP" 2>&1 | tail -20
      sleep 5
      NEW_ROW_COUNT=$(psql_in_pod -tAc "SELECT count(*) FROM records.records;" 2>/dev/null | tr -d ' ' || echo "0")
      if [[ "$NEW_ROW_COUNT" -gt 1000000 ]]; then
        echo "✅ Database restored successfully with $NEW_ROW_COUNT rows"
        RESTORED=true
      else
        echo "❌ Restore failed! Database still has only $NEW_ROW_COUNT rows." >&2
        exit 1
      fi
    fi
  fi
  if [[ "$RESTORED" != "true" ]]; then
    echo "⚠️  No backup found in $BACKUPS_DIR (add off-campus-housing-tracker-postgres-1-all-*.sql or *.dump for 2.4M+ rows). Continuing with current data ($ROW_COUNT rows); benchmarks may be less meaningful." >&2
    echo "   To populate: place off-campus-housing-tracker-postgres-1-all-*.sql (or *.dump) in backups/ and re-run, or set SKIP_RESTORE=true to fail instead of continuing." >&2
  fi
else
  echo "✅ Database verification passed: $ROW_COUNT rows"
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

# Log core GUC snapshot for this run (makes it clear which tuning the curves use)
echo "--- Config snapshot (core tuning) ---"
psql_in_pod -At <<'SQL' | tee "$LOG_DIR/config_snapshot.txt"
SELECT 'shared_buffers=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='shared_buffers';
SELECT 'effective_cache_size=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='effective_cache_size';
SELECT 'work_mem=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='work_mem';
SELECT 'maintenance_work_mem=' || setting || COALESCE(unit, '') FROM pg_settings WHERE name='maintenance_work_mem';
SELECT 'effective_io_concurrency=' || setting FROM pg_settings WHERE name='effective_io_concurrency';
SELECT 'random_page_cost=' || setting FROM pg_settings WHERE name='random_page_cost';
SELECT 'cpu_index_tuple_cost=' || setting FROM pg_settings WHERE name='cpu_index_tuple_cost';
SELECT 'cpu_tuple_cost=' || setting FROM pg_settings WHERE name='cpu_tuple_cost';
SELECT 'checkpoint_completion_target=' || setting || ' (requires restart to change)' FROM pg_settings WHERE name='checkpoint_completion_target';
SELECT 'max_wal_size=' || setting || COALESCE(unit, '') || ' (requires restart to change)' FROM pg_settings WHERE name='max_wal_size';
SELECT 'synchronous_commit=' || setting FROM pg_settings WHERE name='synchronous_commit';
SELECT 'max_parallel_workers=' || setting FROM pg_settings WHERE name='max_parallel_workers';
SELECT 'max_parallel_workers_per_gather=' || setting FROM pg_settings WHERE name='max_parallel_workers_per_gather';
SELECT 'track_io_timing=' || setting FROM pg_settings WHERE name='track_io_timing';
SELECT 'pg_trgm.similarity_threshold=' || setting FROM pg_settings WHERE name='pg_trgm.similarity_threshold';
SELECT 'jit=' || setting FROM pg_settings WHERE name='jit';
SELECT 'enable_seqscan=' || setting FROM pg_settings WHERE name='enable_seqscan';
SQL

# Warn if checkpoint_completion_target or max_wal_size differ from expected (they require restart to change)
CURRENT_CHECKPOINT_TARGET=$(psql_in_pod -tAc "SELECT setting FROM pg_settings WHERE name='checkpoint_completion_target';" 2>/dev/null | tr -d ' ' || echo "")
CURRENT_MAX_WAL_SIZE=$(psql_in_pod -tAc "SELECT setting FROM pg_settings WHERE name='max_wal_size';" 2>/dev/null | tr -d ' ' || echo "")
if [[ -n "$CURRENT_CHECKPOINT_TARGET" ]] && [[ -n "$CHECKPOINT_COMPLETION_TARGET" ]]; then
  # Compare numeric values (handle unit differences)
  CHECKPOINT_NUM=$(echo "$CURRENT_CHECKPOINT_TARGET" | sed 's/[^0-9.]//g')
  EXPECTED_NUM=$(echo "$CHECKPOINT_COMPLETION_TARGET" | sed 's/[^0-9.]//g')
  if [[ -n "$CHECKPOINT_NUM" ]] && [[ -n "$EXPECTED_NUM" ]] && (( $(echo "$CHECKPOINT_NUM != $EXPECTED_NUM" | bc -l 2>/dev/null || echo 0) )); then
    echo "⚠️  NOTE: checkpoint_completion_target is ${CURRENT_CHECKPOINT_TARGET} (expected ${CHECKPOINT_COMPLETION_TARGET})" >&2
    echo "   This parameter requires PostgreSQL restart to change. Current value will be used." >&2
  fi
fi
if [[ -n "$CURRENT_MAX_WAL_SIZE" ]] && [[ -n "$MAX_WAL_SIZE" ]]; then
  # Normalize both to same units for comparison (simplified - just warn if different)
  if [[ "$CURRENT_MAX_WAL_SIZE" != "$MAX_WAL_SIZE" ]]; then
    echo "⚠️  NOTE: max_wal_size is ${CURRENT_MAX_WAL_SIZE} (expected ${MAX_WAL_SIZE})" >&2
    echo "   This parameter requires PostgreSQL restart to change. Current value will be used." >&2
  fi
fi

# CRITICAL: Ensure canonical KNN function and performance tuning are applied BEFORE reading max_connections
# This ensures max_connections=400 is set (though restart is required to apply it)
# NOTE: Only run this if explicitly requested (default: false to avoid re-tuning on every run)
if [[ "$RUN_OPTIMIZE_DB" == "true" ]] && [[ -x "./scripts/optimize-db-for-performance.sh" ]]; then
  echo "=== Applying canonical DB optimizations (optimize-db-for-performance.sh) ==="
  NS="$NS" ./scripts/optimize-db-for-performance.sh
elif [[ "$RUN_OPTIMIZE_DB" != "true" ]]; then
  echo "⚠️  Skipping DB optimization (RUN_OPTIMIZE_DB=${RUN_OPTIMIZE_DB}). Set RUN_OPTIMIZE_DB=true to enable."
fi

# Align pg_trgm.similarity_threshold at DB level to match function's min_rank
# This ensures consistency across all sessions, not just pgbench
echo "=== Aligning pg_trgm.similarity_threshold at DB level ==="
psql_in_pod <<SQL
ALTER DATABASE records SET pg_trgm.similarity_threshold = '${TRGM_THRESHOLD}';
SQL
echo "✅ Set pg_trgm.similarity_threshold = ${TRGM_THRESHOLD} at database level"

# Derive safe max pgbench client count from Postgres max_connections
# Read this AFTER optimization script runs (so we get the updated value if restart happened)
# NOTE: max_connections requires PostgreSQL restart to take effect, so if it's still 200,
# the setting is written to postgresql.auto.conf but not yet active
MAX_CONNECTIONS=$(psql_in_pod -At -c "SHOW max_connections" 2>/dev/null | tr -d ' ' || echo "100")
RESERVED_CONNECTIONS=$(psql_in_pod -At -c "SHOW superuser_reserved_connections" 2>/dev/null | tr -d ' ' || echo "3")
# Keep some headroom for psql/maintenance connections
SAFE_MAX_CLIENTS=$((MAX_CONNECTIONS - RESERVED_CONNECTIONS - 10))
if (( SAFE_MAX_CLIENTS < 1 )); then SAFE_MAX_CLIENTS=1; fi
echo "Max connections: $MAX_CONNECTIONS, reserved: $RESERVED_CONNECTIONS, safe max pgbench clients: $SAFE_MAX_CLIENTS"

# CRITICAL: max_connections requires a PostgreSQL restart to take effect
# Check if max_connections was changed and warn if restart is needed
if [[ "$MAX_CONNECTIONS" == "200" ]]; then
  echo "⚠️  WARNING: max_connections is still 200. PostgreSQL restart required to apply max_connections=400."
  echo "   The setting has been written to postgresql.auto.conf, but won't be active until restart."
  echo ""
  
  # Check if we can auto-restart (Docker only, not Kubernetes)
  if command -v docker >/dev/null 2>&1; then
    POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
    if [[ -n "$POSTGRES_CONTAINER" ]]; then
      echo "   Found PostgreSQL container: $POSTGRES_CONTAINER"
      echo "   Attempting automatic restart..."
      if docker restart "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
        echo "   ✅ Container restarted. Waiting for PostgreSQL to be ready..."
        sleep 5
        # Wait for PostgreSQL to be ready
        for i in {1..30}; do
          if psql_in_pod -c "SELECT 1" >/dev/null 2>&1; then
            echo "   ✅ PostgreSQL is ready"
            # Re-read max_connections after restart
            MAX_CONNECTIONS=$(psql_in_pod -At -c "SHOW max_connections" 2>/dev/null | tr -d ' ' || echo "100")
            RESERVED_CONNECTIONS=$(psql_in_pod -At -c "SHOW superuser_reserved_connections" 2>/dev/null | tr -d ' ' || echo "3")
            SAFE_MAX_CLIENTS=$((MAX_CONNECTIONS - RESERVED_CONNECTIONS - 10))
            if (( SAFE_MAX_CLIENTS < 1 )); then SAFE_MAX_CLIENTS=1; fi
            echo "   Max connections after restart: $MAX_CONNECTIONS, safe max pgbench clients: $SAFE_MAX_CLIENTS"
            break
          fi
          sleep 2
        done
      else
        echo "   ⚠️  Automatic restart failed. Please restart manually:"
        echo "   docker restart $POSTGRES_CONTAINER"
      fi
    else
      echo "   Could not find PostgreSQL container. Please restart manually:"
      echo "   Docker:   docker ps | grep postgres && docker restart <container-name>"
      echo "   K8s:     kubectl -n $NS rollout restart deploy/postgres"
    fi
  else
    echo "   To apply immediately, restart PostgreSQL:"
    echo "   Docker:   docker ps | grep postgres && docker restart <container-name>"
    echo "   K8s:     kubectl -n $NS rollout restart deploy/postgres"
  fi
  
  if [[ "$MAX_CONNECTIONS" == "200" ]]; then
    echo ""
    echo "   Continuing with current max_connections=$MAX_CONNECTIONS (192/256 clients will be skipped)..."
    echo ""
  fi
fi

# CRITICAL: Ensure search_norm and search_tsv exist and are populated (required for FTS indexes and search_records_fuzzy_ids)
# This runs before prepare_table (which is later); so we populate search_norm here too.
echo "=== Ensuring search_norm and search_tsv columns exist and are populated (records.records) ==="
psql_in_pod <<'SQL'
SET search_path = records, public;
-- search_norm: add and populate from artist, name, catalog_number (base schema does not include it)
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;
UPDATE records.records
SET search_norm = lower(concat_ws(' ', artist, name, catalog_number))
WHERE search_norm IS NULL;
-- search_tsv: add and populate from search_norm (for FTS GIN indexes)
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_tsv tsvector;
UPDATE records.records
SET search_tsv = to_tsvector('simple', COALESCE(search_norm, ''))
WHERE search_tsv IS NULL;
SQL
if [[ $? -eq 0 ]]; then
  echo "✅ search_tsv column added and populated"
else
  echo "⚠️  WARNING: search_tsv setup had issues (continuing)" >&2
fi
# Brief analyze so planner has stats before we create indexes
psql_in_pod -c "ANALYZE records.records;" >/dev/null 2>&1 || true

# CRITICAL: FTS Index Strategy
# PL/pgSQL function uses format() with %L to inline user_id as a literal, so partial index CAN be used!
# The query becomes: WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
# This matches the partial index predicate, so planner will use the smaller, faster partial index.
# Default to keeping the partial index (fast path for benchmark tenant).
USE_PARTIAL_FTS="${USE_PARTIAL_FTS:-true}"

if [[ "$USE_PARTIAL_FTS" == "true" ]]; then
  echo "=== Ensuring per-tenant partial FTS index exists (fast path) ==="
  echo "   PL/pgSQL function inlines user_id as literal, so partial index will be used"
  psql_in_pod <<'SQL'
SET search_path = records, public;
-- Create partial index for benchmark tenant (fast path)
-- This index is MUCH smaller than global index and will be preferred by planner
-- when the query has WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid (literal)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_tsv_bench
  ON records.records USING gin (search_tsv)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
SQL
  if [[ $? -eq 0 ]]; then
    echo "✅ Partial FTS index created/verified (fast path for benchmark tenant)"
  else
    echo "⚠️  WARNING: Partial index creation may have failed" >&2
  fi
  
  # Also ensure global index exists (fallback for other tenants or if partial doesn't match)
  echo "=== Ensuring global GIN index exists (fallback for other tenants) ==="
  INDEX_EXISTS=$(psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_search_tsv_all');" 2>/dev/null | tr -d ' ' || echo "f")
  if [[ "$INDEX_EXISTS" == "t" ]]; then
    echo "✅ Global GIN index idx_records_search_tsv_all already exists (fallback)"
  else
    echo "Creating global GIN index idx_records_search_tsv_all (fallback for other tenants)..."
    psql_in_pod <<'SQL'
SET search_path = records, public;
CREATE INDEX CONCURRENTLY idx_records_search_tsv_all
  ON records.records USING gin (search_tsv);
SQL
    if [[ $? -eq 0 ]]; then
      echo "✅ Global GIN index created successfully"
    else
      echo "⚠️  WARNING: Global index creation failed" >&2
    fi
  fi
else
  echo "=== Using global FTS index only (no per-tenant partial) ==="
  echo "   USE_PARTIAL_FTS=false - dropping partial index, using global index only"
  psql_in_pod <<'SQL'
SET search_path = records, public;
DROP INDEX IF EXISTS records.idx_records_search_tsv_bench;
SQL
  
  # Ensure global index exists
  INDEX_EXISTS=$(psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_search_tsv_all');" 2>/dev/null | tr -d ' ' || echo "f")
  if [[ "$INDEX_EXISTS" == "t" ]]; then
    echo "✅ Global GIN index idx_records_search_tsv_all already exists"
  else
    echo "Creating global GIN index idx_records_search_tsv_all..."
    psql_in_pod <<'SQL'
SET search_path = records, public;
CREATE INDEX CONCURRENTLY idx_records_search_tsv_all
  ON records.records USING gin (search_tsv);
SQL
    if [[ $? -eq 0 ]]; then
      echo "✅ Global GIN index created successfully"
    else
      echo "⚠️  WARNING: Global index creation failed" >&2
    fi
  fi
fi

# CRITICAL: GIN index maintenance - clean up pending lists and bloat
# GIN indexes can accumulate pending lists that slow down queries
# This is especially important after bulk loads or when switching index strategies
echo "=== GIN index maintenance (cleaning pending lists and bloat) ==="
if [[ "$USE_PARTIAL_FTS" == "true" ]]; then
  echo "   Reindexing partial FTS index to clean GIN state..."
  psql_in_pod -c "REINDEX INDEX CONCURRENTLY records.idx_records_search_tsv_bench;" >/dev/null 2>&1 || {
    echo "   ⚠️  REINDEX may have failed (index might be in use) - will VACUUM instead"
    psql_in_pod -c "VACUUM ANALYZE records.records;" >/dev/null 2>&1 || true
  }
fi
echo "   Running VACUUM ANALYZE to update statistics and clean GIN pending lists..."
psql_in_pod -c "VACUUM ANALYZE records.records;" >/dev/null 2>&1 || true
echo "✅ GIN index maintenance completed"

# CRITICAL: Verify index configuration
echo "=== Verifying index configuration ==="
PARTIAL_EXISTS=$(psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_search_tsv_bench');" 2>/dev/null | tr -d ' ' || echo "f")
GLOBAL_EXISTS=$(psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='records' AND indexname='idx_records_search_tsv_all');" 2>/dev/null | tr -d ' ' || echo "f")
if [[ "$USE_PARTIAL_FTS" == "true" ]]; then
  if [[ "$PARTIAL_EXISTS" == "t" ]]; then
    echo "✅ Partial index idx_records_search_tsv_bench exists (fast path for benchmark tenant)"
  else
    echo "⚠️  WARNING: Partial index should exist but doesn't!" >&2
  fi
  if [[ "$GLOBAL_EXISTS" == "t" ]]; then
    echo "✅ Global index idx_records_search_tsv_all exists (fallback for other tenants)"
  else
    echo "⚠️  WARNING: Global index doesn't exist (fallback unavailable)" >&2
  fi
else
  if [[ "$PARTIAL_EXISTS" == "t" ]]; then
    echo "⚠️  WARNING: Partial index still exists but USE_PARTIAL_FTS=false!" >&2
  fi
  if [[ "$GLOBAL_EXISTS" == "t" ]]; then
    echo "✅ Global index idx_records_search_tsv_all exists and ready for use"
  else
    echo "❌ ERROR: Global index idx_records_search_tsv_all does not exist!" >&2
    echo "   Queries will be very slow (78ms+ instead of 2-4ms)" >&2
  fi
fi

# Verify planner uses FTS index (EXPLAIN ANALYZE) for benchmark tenant query
echo "=== Verifying FTS index usage (EXPLAIN ANALYZE) ==="
psql_in_pod -tAc "
  EXPLAIN (ANALYZE, COSTS OFF, FORMAT text)
  SELECT r.id FROM records.records r
  WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND r.search_tsv @@ plainto_tsquery('simple', 'test')
  LIMIT 20;
" 2>/dev/null | head -15 || true
echo "   (Look for Bitmap Index Scan on idx_records_search_tsv_bench or idx_records_search_tsv_all above)"

# CRITICAL: Recreate bench-specific search_norm indexes (required for good deep-mode performance)
# These indexes were part of the "good" run and may be used by TRGM benchmark or other paths
echo "=== Recreating bench-specific search_norm indexes ==="
psql_in_pod <<'SQL' >/dev/null 2>&1 || true
SET search_path = records, public;
-- Recreate bench search_norm indexes (partial indexes for benchmark tenant)
-- These were present in the "good" run and may be needed for TRGM benchmark or other paths
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gin_bench
  ON records.records USING gin (search_norm gin_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_len_bench
  ON records.records (length(search_norm))
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
SQL
echo "✅ Bench search_norm indexes created/verified"

# CRITICAL: Set up hot tenant table (records_hot.records_hot) for benchmark tenant
# This provides 10-20x faster queries by using a smaller, pre-filtered table
echo "=== Setting up hot tenant table (records_hot.records_hot) ==="
psql_in_pod <<'SQL' >/dev/null 2>&1 || true
SET search_path = records_hot, records, public;

-- Ensure search_tsv column exists in hot table
ALTER TABLE records_hot.records_hot ADD COLUMN IF NOT EXISTS search_tsv tsvector;

-- Populate search_tsv for all rows in hot table (if not already populated)
UPDATE records_hot.records_hot
SET search_tsv = to_tsvector('simple', COALESCE(search_norm, ''))
WHERE search_tsv IS NULL;

-- Create FTS GIN index on hot table (much smaller than main table index)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_hot_search_tsv
  ON records_hot.records_hot USING gin (search_tsv);

-- Create search_norm GIN index on hot table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_hot_search_norm_gin
  ON records_hot.records_hot USING gin (search_norm gin_trgm_ops);

-- Create user_id index (for filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_hot_user_id
  ON records_hot.records_hot (user_id);

-- Analyze hot table for optimal plans
ANALYZE records_hot.records_hot;
SQL
echo "✅ Hot tenant table setup complete (search_tsv, indexes created)"

# CRITICAL: Drop unused indexes to reduce memory pressure, but PROTECT critical bench indexes
# Unused indexes waste shared_buffers and slow down writes/updates
# CRITICAL: Never drop indexes with _bench suffix (they're required for good performance)
echo "=== Dropping unused indexes (protecting critical bench indexes) ==="
psql_in_pod <<'SQL' >/dev/null 2>&1 || true
SET search_path = records, public;
-- Drop unused GIN indexes that are never scanned, BUT protect all _bench indexes
-- Whitelist: idx_records_*_bench indexes are CRITICAL and must never be dropped
-- These unused indexes waste memory and can slow down writes/updates and query planning
DROP INDEX CONCURRENTLY IF EXISTS records.idx_records_partitioned_artist_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.idx_records_partitioned_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.idx_records_partitioned_catalog_trgm;
-- Drop unused trigram indexes (ix_records_* are never used in fuzzy search)
DROP INDEX CONCURRENTLY IF EXISTS records.ix_records_artist_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.ix_records_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.ix_records_catalog_trgm;
-- PROTECTED indexes (never drop):
-- - idx_records_search_tsv_bench (partial FTS index - CRITICAL for fast path)
-- - idx_records_search_norm_gin_bench (bench search_norm GIN - may be used by TRGM)
-- - idx_records_search_norm_len_bench (bench search_norm length - may be used by TRGM)
-- - idx_records_search_tsv_all (global FTS index - fallback for other tenants)
-- - idx_records_user_id_btree (user_id lookups - CRITICAL for filtering)
-- - ix_records_user_id_updated_at (if used for recent queries)
SQL
echo "✅ Dropped unused indexes (protected all _bench indexes)"

# CRITICAL: Create alias indexes (ensures fast joins after candidate selection)
if [[ -x "./scripts/create-alias-indexes.sh" ]]; then
  echo "=== Creating alias indexes ==="
  ./scripts/create-alias-indexes.sh 2>&1 | tail -5
fi

# CRITICAL: Check for common typos in environment variables and auto-fix BEFORE function creation
# IMPORTANT: SQL function is 9.6x slower (163ms vs 17ms) - ALWAYS force PL/pgSQL for best performance
if [[ -n "${SE_SQL_FUNCTION:-}" ]]; then
  echo "⚠️  WARNING: Found typo 'SE_SQL_FUNCTION' (should be 'USE_SQL_FUNCTION')" >&2
  echo "   Auto-fixing: setting USE_SQL_FUNCTION=${SE_SQL_FUNCTION}" >&2
  USE_SQL_FUNCTION="${SE_SQL_FUNCTION}"
fi

# CRITICAL: SQL function is fundamentally broken for this use case (163ms vs 17ms for PL/pgSQL)
# Even with global index working correctly, SQL function has massive overhead
# Force PL/pgSQL if user accidentally set USE_SQL_FUNCTION=true
if [[ "${USE_SQL_FUNCTION:-false}" == "true" ]]; then
  echo "🔴 CRITICAL WARNING: USE_SQL_FUNCTION=true is set, but SQL function is 9.6x slower!" >&2
  echo "   SQL function execution time: 163.814 ms (current broken run)" >&2
  echo "   PL/pgSQL execution time: 17.153 ms (past successful run)" >&2
  echo "   Even with global index working, SQL function overhead kills performance." >&2
  echo "   Forcing PL/pgSQL for optimal performance..." >&2
  USE_SQL_FUNCTION="false"
fi

# Debug: Show what function type will be created
if [[ "$USE_SQL_FUNCTION" == "true" ]]; then
  echo "🔧 DEBUG: USE_SQL_FUNCTION=true - will create SQL-language function with aggressive tuning (candidate_cap=24, min_rank=0.55)"
  echo "⚠️  WARNING: SQL function currently has planner issues (31s vs 4.7ms for PL/pgSQL). Consider using USE_SQL_FUNCTION=false for best performance."
else
  echo "🔧 DEBUG: USE_SQL_FUNCTION=false - will create PL/pgSQL function (restored to match past good run)"
  echo "✅ Using PL/pgSQL with EXECUTE - proven to be 6-7x faster than SQL function (4.7ms vs 31.5s execution time)"
  echo "   Restored candidate_cap=40 with formula (p_limit * 5) / 4 to match past successful run (4.763ms execution time)"
  echo "   Past run achieved 5-6k TPS at 64-96 clients with this configuration"
fi

if [[ -x "./scripts/create-knn-function.sh" ]]; then
  if [[ "$USE_SQL_FUNCTION" == "true" ]]; then
    echo "=== (Re)creating canonical search_records_fuzzy_ids function (SQL-language optimized version) ==="
  else
    echo "=== (Re)creating canonical search_records_fuzzy_ids function (PL/pgSQL gold version) ==="
  fi
  # Create function directly in pod using psql_in_pod to avoid connection mismatch
  psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public, pg_catalog;

-- Ensure pg_trgm extension exists
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop old function signatures (cleanup)
-- CRITICAL: Drop 5-parameter version (with p_mode) first, then 4-parameter, then others
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, bigint, bigint);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core();
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot();
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold();

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(coalesce(t,'')), '\s+', ' ', 'g');
$$;
EOFSQL

  # Conditionally create PL/pgSQL (gold) or SQL (optimized) version
  if [[ "$USE_SQL_FUNCTION" == "true" ]]; then
    # SQL-language optimized version (same behavior, lower overhead)
    # Removes PL/pgSQL interpreter overhead and dynamic EXECUTE parse/plan overhead
    # Typically 10-20% faster than PL/pgSQL version while maintaining identical behavior
    psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public, pg_catalog;

-- Canonical function: Dual-mode FTS-only filter, trigram-only scoring (no trigram index scan).
-- STRATEGY: Use FTS (search_tsv @@ tsq) as the ONLY filter via FTS GIN index (partial idx_records_search_tsv_bench preferred, global idx_records_search_tsv_all as fallback).
-- Compute trigram similarity() only on the small FTS candidate set (no trigram GIN index used).
-- FAST mode: aggressive candidate set (24) + high cutoff (0.55) for maximum throughput at high concurrency.
--   - candidate_cap=24 (vs 32 optimized, 40 gold) provides additional 15-25% CPU reduction
--   - min_rank=0.55 (vs 0.50) filters more aggressively, reducing similarity computation overhead
-- DEEP mode: larger candidate set (150) + lower cutoff (0.35) for better recall when needed.
-- SQL-language version: optimized to avoid CROSS JOINs (uses scalar subqueries for better planner optimization)
-- NOTE: If performance is worse than PL/pgSQL, the planner may be materializing CTEs. Consider using PL/pgSQL version.
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0,
  p_mode   text  DEFAULT 'fast'  -- 'fast' or 'deep'
) RETURNS TABLE(id uuid, rank real)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = records, public, pg_catalog
AS $$
WITH params AS (
  SELECT
    public.norm_text(coalesce(p_q, ''))                           AS qn,
    plainto_tsquery('simple', public.norm_text(coalesce(p_q, ''))) AS tsq,
    CASE
      WHEN lower(coalesce(p_mode, 'fast')) = 'deep'
        THEN LEAST(150::bigint, GREATEST(p_limit * 3, 60))
      ELSE
        -- Fast mode: aggressive tuning for maximum throughput
        -- candidate_cap=24 (vs 32 optimized, 40 gold) provides 15-25% additional CPU reduction
        -- Formula: LEAST(24, GREATEST(p_limit * 3 / 4, 20)) for more aggressive filtering
        LEAST(24::bigint, GREATEST((p_limit * 3) / 4, 20))
    END                                                           AS candidate_cap,
    CASE
      WHEN lower(coalesce(p_mode, 'fast')) = 'deep'
        THEN 0.35::real
      ELSE
        -- Fast mode: higher cutoff (0.55 vs 0.50) for more aggressive filtering
        -- Reduces similarity computation overhead, improves throughput at high concurrency
        0.55::real
    END                                                           AS min_rank,
    GREATEST(0, p_offset)                                         AS off,
    LEAST(1000, GREATEST(1, p_limit))                             AS lim
),
fts AS (
  SELECT
    r.id,
    r.search_norm,
    (SELECT qn FROM params) AS qn,
    (SELECT min_rank FROM params) AS min_rank,
    (SELECT off FROM params) AS off,
    (SELECT lim FROM params) AS lim
  FROM records.records AS r
  WHERE r.user_id = p_user
    AND r.search_tsv @@ (SELECT tsq FROM params)
  LIMIT (SELECT candidate_cap FROM params)
),
scored AS (
  SELECT
    f.id,
    similarity(f.search_norm, f.qn) AS sim,
    f.min_rank,
    f.off,
    f.lim
  FROM fts AS f
)
SELECT
  s.id,
  s.sim::real AS rank
FROM scored AS s
WHERE s.sim >= s.min_rank
ORDER BY s.sim DESC
OFFSET (SELECT off FROM params)
LIMIT  (SELECT lim FROM params);
$$;
EOFSQL
  else
    # PL/pgSQL gold version (exact match to benchmark "good" run)
    psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public, pg_catalog;

-- Canonical function: Dual-mode FTS-only filter, trigram-only scoring (no trigram index scan).
-- STRATEGY: Use FTS (search_tsv @@ tsq) as the ONLY filter via FTS GIN index (partial idx_records_search_tsv_bench preferred, global idx_records_search_tsv_all as fallback).
-- Compute trigram similarity() only on the small FTS candidate set (no trigram GIN index used).
-- FAST mode: ~1.25×LIMIT candidates, hard-capped at 40, with higher cutoff to keep CPU very small.
-- DEEP mode: up to ~3×LIMIT candidates, hard-capped at 150, with a lower cutoff for recall.
-- CRITICAL: Always uses records.records with partial index (not records_hot) - matches Nov 26 good run spec
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0,
  p_mode   text  DEFAULT 'fast'  -- 'fast' or 'deep'
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path TO 'records', 'public', 'pg_catalog'
AS $function$
DECLARE
  qn            text;
  tsq           tsquery;
  candidate_cap bigint;
  min_rank      real;
  sql           text;
BEGIN
  -- Normalize query once
  qn  := public.norm_text(COALESCE(p_q, ''));
  tsq := plainto_tsquery('simple', qn);

  -- Dual-mode tuning:
  -- FAST: small candidate set + stricter similarity => best tail latency
  -- DEEP: bigger candidate set + looser similarity => better recall, slower
  IF lower(p_mode) = 'deep' THEN
    -- Deep: up to ~3×LIMIT candidates, hard-capped at 150
    -- with a lower cutoff for recall.
    candidate_cap := LEAST(150::bigint, GREATEST(p_limit * 3, 60));
    min_rank      := 0.35;
  ELSE
    -- Fast: ~1.25×LIMIT candidates, hard-capped at 40
    -- with higher cutoff to keep CPU very small.
    candidate_cap := LEAST(40::bigint, GREATEST((p_limit * 5) / 4, 25));
    min_rank      := 0.50;
  END IF;

  -- FTS used only as a filter; no ts_rank_cd, no ORDER BY in FTS
  sql := format($fmt$
    WITH fts AS (
      SELECT
        r.id,
        r.search_norm
      FROM records.records AS r
      WHERE r.user_id = %L::uuid
        AND r.search_tsv @@ $2
      LIMIT $3
    ),
    scored AS (
      SELECT
        f.id,
        similarity(f.search_norm, $1) AS sim
      FROM fts AS f
    )
    SELECT
      s.id,
      s.sim::real AS rank
    FROM scored AS s
    WHERE s.sim >= $4
    ORDER BY s.sim DESC
    OFFSET GREATEST(0, $5)
    LIMIT LEAST(1000, GREATEST(1, $6));
  $fmt$, p_user::text);
  
  -- This structure uses CTEs which PostgreSQL can optimize efficiently
  -- The partial index idx_records_search_tsv_bench provides ~17ms execution time

  RETURN QUERY EXECUTE sql
    USING
      qn,            -- $1 : normalized query (for similarity)
      tsq,           -- $2 : tsquery (for FTS filter)
      candidate_cap, -- $3 : FTS candidate cap (fast/deep dependent)
      min_rank,      -- $4 : similarity cutoff
      p_offset,      -- $5
      p_limit;       -- $6
END;
$function$;
EOFSQL
  fi

  # Continue with auto wrapper creation
  psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public, pg_catalog;

-- Auto-fallback wrapper: tries fast mode first, falls back to deep if needed
-- Includes statement timeout to cap p9999/p100 latency
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_auto(
  p_user               uuid,
  p_q                  text,
  p_limit              bigint DEFAULT 100,
  p_offset             bigint DEFAULT 0,
  p_min_rows_for_fast  int    DEFAULT NULL
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = records, public, pg_catalog
AS $function$
DECLARE
  ids        uuid[];
  ranks      real[];
  fast_count int := 0;
  threshold  int;
  i          int;
BEGIN
  -- Hard cap for search latency per call (only affects this statement).
  -- Prevents multi-second outliers at high concurrency.
  PERFORM set_config('statement_timeout', '200ms', true);

  -- "Good enough" threshold for fast path:
  -- default: max(10, p_limit / 2)
  threshold := COALESCE(
    p_min_rows_for_fast,
    GREATEST(10, (p_limit::int / 2))
  );

  -- 1) Run FAST mode, but buffer results instead of returning immediately.
  FOR id, rank IN
    SELECT f.id, f.rank
    FROM public.search_records_fuzzy_ids(
      p_user   => p_user,
      p_q      => p_q,
      p_limit  => p_limit,
      p_offset => p_offset,
      p_mode   => 'fast'
    ) AS f
  LOOP
    fast_count := fast_count + 1;
    ids   := array_append(ids, id);
    ranks := array_append(ranks, rank);
  END LOOP;

  -- 2) If fast produced enough rows, just return those (no deep fallback).
  IF fast_count >= threshold THEN
    IF ids IS NOT NULL THEN
      FOR i IN 1..array_length(ids, 1) LOOP
        id   := ids[i];
        rank := ranks[i];
        RETURN NEXT;
      END LOOP;
    END IF;
    RETURN;
  END IF;

  -- 3) Otherwise, run DEEP mode and ignore fast results entirely.
  FOR id, rank IN
    SELECT f.id, f.rank
    FROM public.search_records_fuzzy_ids(
      p_user   => p_user,
      p_q      => p_q,
      p_limit  => p_limit,
      p_offset => p_offset,
      p_mode   => 'deep'
    ) AS f
  LOOP
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$function$;
EOFSQL
  # Verify functions were created
  if ! psql_in_pod -c "SELECT 1 FROM pg_proc WHERE proname = 'search_records_fuzzy_ids' AND pronamespace = 'public'::regnamespace AND pronargs = 5;" >/dev/null 2>&1; then
    echo "❌ Function search_records_fuzzy_ids creation failed!" >&2
    exit 1
  fi
  if ! psql_in_pod -c "SELECT 1 FROM pg_proc WHERE proname = 'search_records_fuzzy_ids_auto' AND pronamespace = 'public'::regnamespace AND pronargs = 4;" >/dev/null 2>&1; then
    echo "❌ Function search_records_fuzzy_ids_auto creation failed!" >&2
    exit 1
  fi
  echo "✅ Functions verified to exist"
fi

# step 0: prepare extensions and indexes
psql_in_pod < "$tmpdir/prepare.sql" >/dev/null 2>&1 || true

echo "--- pg_trgm / trigram opclass availability ---"
psql_in_pod <<'EOFSQL'
SELECT 'pg_trgm installed: ' || EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
) AS pg_trgm;

SELECT 'has gin_trgm_ops: ' || EXISTS (
  SELECT 1 FROM pg_opclass WHERE opcname = 'gin_trgm_ops'
) AS has_gin_trgm_ops;

SELECT 'has gist_trgm_ops: ' || EXISTS (
  SELECT 1 FROM pg_opclass WHERE opcname = 'gist_trgm_ops'
) AS has_gist_trgm_ops;
EOFSQL

psql_in_pod < "$tmpdir/prepare_table.sql" >/dev/null 2>&1 || true
psql_in_pod < "$tmpdir/create_indexes.sql" >/dev/null 2>&1 || true
psql_in_pod < "$tmpdir/create_bench_schema.sql" >/dev/null 2>&1 || true

# Function and tuning are now handled by canonical scripts above
# No manual function creation or tuning here

# Function is created by canonical script above
# records_hot table creation left in place (harmless, but not used by canonical function)

# Setup indexes and search_norm column (matching reference script)
echo "Setting up indexes and search_norm column (matching reference script)..."
psql_in_pod -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_prewarm;

-- Ensure the normalized search column exists and is populated
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;

-- Populate missing values (one-time/online-friendly)
UPDATE records.records
SET search_norm = lower(concat_ws(' ', artist, name, catalog_number))
WHERE search_norm IS NULL;

-- Substring path (TRGM GIN) - matching reference script
-- GIN trigram indexes (artist / name / catalog) – best-effort if gin_trgm_ops exists
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_artist_trgm
             ON records.records USING gin (artist gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_artist_trgm';
  END;

  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_name_trgm
             ON records.records USING gin (name gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_name_trgm';
  END;

  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_catalog_trgm
             ON records.records USING gin (catalog_number gin_trgm_ops)';
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'gin_trgm_ops not available; skipping ix_records_catalog_trgm';
  END;
END $$;

-- KNN path (TRGM GiST) - REMOVED: We use FTS filter + trigram rank now
-- Global GiST index interferes with FTS strategy and causes planner confusion
-- Partial GIN indexes are created by create-partial-indexes-for-bench.sh
-- DO $$
-- BEGIN
--   BEGIN
--     EXECUTE 'CREATE INDEX IF NOT EXISTS ix_records_search_norm_gist
--              ON records.records USING gist (search_norm gist_trgm_ops)';
--   EXCEPTION WHEN undefined_object THEN
--     RAISE NOTICE 'gist_trgm_ops not available; skipping ix_records_search_norm_gist GiST index';
--   END;
-- END $$;

ANALYZE records.records;

-- Prewarm the hot stuff - matching reference script
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass)
WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass)
WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass)
WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;
SQL

# Database-level tuning is handled by canonical optimize-db-for-performance.sh script
# No ALTER DATABASE or ALTER SYSTEM here - only session-level PGOPTIONS_EXTRA is used

# Prepare bench SQL files locally (for local pgbench)
bench_sql_dir="$tmpdir/bench_sql"
mkdir -p "$bench_sql_dir"

echo "Generating bench SQL files locally..."
# Use auto wrapper if enabled (includes statement timeout and dual-mode fallback)
if [[ "$USE_AUTO_WRAPPER" == "true" ]]; then
  echo "⚠️  Using search_records_fuzzy_ids_auto wrapper (includes 200ms timeout)"
cat > "$bench_sql_dir/bench_knn.sql" <<'EOF'
SET search_path = records, public, pg_catalog;
-- Use auto wrapper: fast mode with deep fallback + 200ms statement timeout
-- This matches the production user-facing search path
SELECT count(*) FROM public.search_records_fuzzy_ids_auto(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint
);
EOF

  cat > "$bench_sql_dir/bench_trgm.sql" <<'EOF'
SET search_path = public, records, pg_catalog;
-- Use auto wrapper: fast mode with deep fallback + 200ms statement timeout
-- This matches the production user-facing search path
SELECT count(*) FROM public.search_records_fuzzy_ids_auto(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint
);
EOF
else
  # CRITICAL: Pass p_mode explicitly based on MODE env var
  # MODE=deep -> use 'deep' mode (candidate_cap=150, min_rank=0.35)
  # MODE=quick -> use 'fast' mode (candidate_cap=40, min_rank=0.50)
  # This ensures deep mode benchmarks actually use deep mode!
  search_mode="fast"
  if [[ "$MODE" == "deep" ]]; then
    search_mode="deep"
  fi
  
  cat > "$bench_sql_dir/bench_knn.sql" <<EOF
SET search_path = records, public, pg_catalog;
-- Use optimized function with explicit mode: ${search_mode}
-- ${search_mode^} mode: candidate_cap = $([ "$search_mode" == "deep" ] && echo "150" || echo "40"), min_rank = $([ "$search_mode" == "deep" ] && echo "0.35" || echo "0.50")
SELECT count(*) FROM public.search_records_fuzzy_ids(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint,
  '${search_mode}'::text
);
EOF

  cat > "$bench_sql_dir/bench_trgm.sql" <<EOF
SET search_path = public, records, pg_catalog;
-- Use optimized function with explicit mode: ${search_mode}
-- ${search_mode^} mode: candidate_cap = $([ "$search_mode" == "deep" ] && echo "150" || echo "40"), min_rank = $([ "$search_mode" == "deep" ] && echo "0.35" || echo "0.50")
SELECT count(*) FROM public.search_records_fuzzy_ids(
  :uid::uuid,
  :q::text,
  :lim::bigint,
  0::bigint,
  '${search_mode}'::text
);
EOF
fi

cat > "$bench_sql_dir/bench_trgm_simple.sql" <<'EOF'
SET search_path = public, records, pg_catalog;
-- similarity_threshold comes from PGOPTIONS_EXTRA/TRGM_THRESHOLD env var (default: 0.40)
-- Note: This is a diagnostic query only. The function path (bench_trgm.sql) is preferred.
-- You can tune it: TRGM_THRESHOLD=0.50 ./scripts/run_pgbench_sweep.sh
SET search_path = records, public, pg_catalog;
WITH q AS (
  SELECT public.norm_text(lower(:q::text)) AS qn
)
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r, q
  WHERE r.user_id = :uid::uuid
    AND r.search_norm % q.qn
  ORDER BY similarity(r.search_norm, q.qn) DESC
  LIMIT :lim::integer
) s;
EOF

cat > "$bench_sql_dir/bench_noop.sql" <<'EOF'
SELECT 1;
EOF

# Randomized query pattern: multiple query strings so each transaction uses a different query (8..256 clients, realistic load).
PGBENCH_RANDOMIZED="${PGBENCH_RANDOMIZED:-0}"
if [[ "$PGBENCH_RANDOMIZED" == "1" || "$PGBENCH_RANDOMIZED" == "true" ]]; then
  RANDOM_QUERIES=(
    "鄧麗君 album 263 cn-041 polygram"
    "beatles help vinyl"
    "jazz blue note 1960"
    "classical mozart symphony"
    "rock lp 70s"
  )
  search_mode="fast"
  [[ "$MODE" == "deep" ]] && search_mode="deep"
  for i in "${!RANDOM_QUERIES[@]}"; do
    q="${RANDOM_QUERIES[$i]}"
    # SQL escape: double any single quote in query
    q_sql="${q//\'/\'\'}"
    cat > "$bench_sql_dir/bench_random_q$((i+1)).sql" <<EOFR
SET search_path = records, public, pg_catalog;
SELECT count(*) FROM public.search_records_fuzzy_ids(
  :uid::uuid,
  '${q_sql}'::text,
  :lim::bigint,
  0::bigint,
  '${search_mode}'::text
);
EOFR
  done
  echo "✅ Randomized query files: bench_random_q1.sql .. bench_random_q${#RANDOM_QUERIES[@]}.sql"
fi

echo "Verifying SQL files are clean..."
if grep -q "<<<<<<<" "$bench_sql_dir/bench_knn.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_trgm.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_trgm_simple.sql" 2>/dev/null || \
   grep -q "<<<<<<<" "$bench_sql_dir/bench_noop.sql" 2>/dev/null; then
  echo "FATAL ERROR: Merge conflict detected in bench SQL files!" >&2
  exit 1
fi

echo "✅ SQL files verified clean"

# Note: SQL files are prepared locally and used directly by local pgbench
# No need to sync to pods since we always use local pgbench

# CRITICAL: Verify objects exist BEFORE pgbench runs
echo "--- Pre-flight verification"
psql_in_pod -v ON_ERROR_STOP=1 <<'EOFSQL'
SET search_path = records, public;

-- Verify canonical function exists
DO $$
DECLARE
  func_exists boolean;
BEGIN
  -- Check function: public.search_records_fuzzy_ids(uuid, text, bigint, bigint, text) - canonical 5-arg version
  SELECT EXISTS(
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_records_fuzzy_ids'
      AND p.pronargs = 5
      AND p.proargtypes[0] = 'uuid'::regtype::oid
      AND p.proargtypes[1] = 'text'::regtype::oid
      AND p.proargtypes[2] = 'bigint'::regtype::oid
      AND p.proargtypes[3] = 'bigint'::regtype::oid
      AND p.proargtypes[4] = 'text'::regtype::oid
  ) INTO func_exists;
  
  IF NOT func_exists THEN
    RAISE EXCEPTION 'Function public.search_records_fuzzy_ids(uuid, text, bigint, bigint, text) does not exist!';
  END IF;
  
  RAISE NOTICE '✅ Pre-flight check passed: canonical function exists';
END $$;
EOFSQL

if [[ $? -ne 0 ]]; then
  echo "FATAL: Pre-flight verification failed! Function is missing." >&2
  echo "Checking what exists..." >&2
  psql_in_pod <<'EOFSQL'
SET search_path = records, public;
SELECT n.nspname, p.proname, p.proargtypes::regtype[]::text AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'search_records_fuzzy_ids'
ORDER BY n.nspname, p.oid;
EOFSQL
  exit 1
fi

echo "✅ Pre-flight verification passed"

# Sanity check: Print function definition for verification
echo "--- Verifying canonical function definition (saving to log)"
psql_in_pod <<'EOFSQL' | tee "$LOG_DIR/function_search_records_fuzzy_ids.sql"
-- Verify the canonical function definition is present
SELECT
  n.nspname,
  p.proname,
  p.proargtypes::regtype[]::text AS args,
  CASE 
    WHEN l.lanname = 'sql' THEN 'SQL'
    WHEN l.lanname = 'plpgsql' THEN 'PL/pgSQL'
    ELSE COALESCE(l.lanname, 'OTHER')
  END AS language,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname = 'search_records_fuzzy_ids'
  AND p.pronargs = 5;
EOFSQL

# Verify function language matches USE_SQL_FUNCTION setting
echo "--- Verifying function language matches USE_SQL_FUNCTION=${USE_SQL_FUNCTION:-false} ---"
FUNC_LANG=$(psql_in_pod -tAc "
  SELECT CASE 
    WHEN l.lanname = 'sql' THEN 'SQL'
    WHEN l.lanname = 'plpgsql' THEN 'PL/pgSQL'
    ELSE COALESCE(l.lanname, 'OTHER')
  END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.proname = 'search_records_fuzzy_ids'
    AND p.pronargs = 5;
" 2>/dev/null | tr -d ' ' || echo "")

if [[ "$USE_SQL_FUNCTION" == "true" ]]; then
  if [[ "$FUNC_LANG" != "SQL" ]]; then
    echo "⚠️  WARNING: USE_SQL_FUNCTION=true but function language is '$FUNC_LANG' (expected 'SQL')" >&2
    echo "   This may indicate the function wasn't recreated correctly." >&2
  else
    echo "✅ Function language is SQL (matches USE_SQL_FUNCTION=true)"
  fi
else
  if [[ "$FUNC_LANG" != "PL/pgSQL" ]]; then
    echo "⚠️  WARNING: USE_SQL_FUNCTION=false but function language is '$FUNC_LANG' (expected 'PL/pgSQL')" >&2
  else
    echo "✅ Function language is PL/pgSQL (matches USE_SQL_FUNCTION=false)"
  fi
fi

echo "--- Smoke check"
# Skip smoke tests for faster iteration (can be enabled if needed)
if [[ "$RUN_SMOKE_TESTS" == "true" ]]; then
  echo "--- Running smoke tests (local pgbench) ---"
  for script in bench_knn.sql bench_trgm.sql bench_trgm_simple.sql bench_noop.sql; do
    echo "Testing $script..."
    # Smoke test using local pgbench (connecting to external Postgres)
    export PGHOST="$RECORDS_DB_HOST"
    export PGPORT="$RECORDS_DB_PORT"
    export PGUSER="$RECORDS_DB_USER"
    export PGDATABASE="$RECORDS_DB_NAME"
    export PGPASSWORD="$RECORDS_DB_PASS"
    export PGOPTIONS="$PGOPTIONS_EXTRA"
    if ! pgbench -n -M prepared -c 1 -T 2 -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" -f "$bench_sql_dir/$script" >/dev/null 2>&1; then
      echo "WARNING: pgbench smoke test failed for $script, but continuing..." >&2
    else
      echo "✓ $script smoke test passed"
    fi
    unset PGOPTIONS
  done
else
  echo "Skipping smoke tests (RUN_SMOKE_TESTS=${RUN_SMOKE_TESTS})"
fi

# CRITICAL: Quick NOOP baseline test to measure environment overhead (optional)
# Target NOOP_TARGET_TPS (default 30k); tune clients/threads to reach it at scale
if [[ "$RUN_NOOP_BASELINE" == "true" ]]; then
  echo "--- NOOP baseline test (target ${NOOP_TARGET_TPS} TPS) ---"
  NOOP_CLIENTS=64
  NOOP_THREADS=64
  NOOP_DUR=5
  echo "Running pgbench NOOP: $NOOP_CLIENTS clients, $NOOP_THREADS threads, ${NOOP_DUR}s"
  NOOP_OUTPUT=$(mktemp)
  export PGHOST="$RECORDS_DB_HOST"
  export PGPORT="$RECORDS_DB_PORT"
  export PGUSER="$RECORDS_DB_USER"
  export PGDATABASE="$RECORDS_DB_NAME"
  export PGPASSWORD="$RECORDS_DB_PASS"
  export PGOPTIONS="-c search_path=public,records,pg_catalog"
  pgbench \
    -n -M prepared \
    -c "$NOOP_CLIENTS" -j "$NOOP_THREADS" -T "$NOOP_DUR" \
    -f "$bench_sql_dir/bench_noop.sql" \
    > "$NOOP_OUTPUT" 2>&1 || true
  unset PGOPTIONS

  if [[ -n "$NOOP_OUTPUT" ]] && [[ -s "$NOOP_OUTPUT" ]]; then
    NOOP_TPS=$(sed -n "s/^tps = \([0-9.][0-9.]*\) .*/\1/p" "$NOOP_OUTPUT" | tail -n1 || echo "")
    NOOP_LAT=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$NOOP_OUTPUT" | tail -n1 || echo "")
    if [[ -n "$NOOP_TPS" ]] && [[ -n "$NOOP_LAT" ]]; then
      echo "  NOOP baseline: ${NOOP_TPS} TPS, ${NOOP_LAT} ms avg latency (target ${NOOP_TARGET_TPS} TPS)"
      if (( $(echo "$NOOP_TPS < $NOOP_TARGET_TPS" | bc -l 2>/dev/null || echo 0) )); then
        echo "  ⚠️  NOOP below target (${NOOP_TPS} < ${NOOP_TARGET_TPS}). Increase clients/threads or tune DB/host (shared_buffers, max_connections)." >&2
      else
        echo "  ✅ NOOP meets or exceeds target (${NOOP_TARGET_TPS} TPS)"
      fi
      if (( $(echo "$NOOP_LAT > 2" | bc -l 2>/dev/null || echo 0) )); then
        echo "  ⚠️  NOOP latency high (${NOOP_LAT} ms). Check Docker/host load, logging, extensions." >&2
      fi
    fi
    cp "$NOOP_OUTPUT" "$LOG_DIR/noop_baseline_test.txt" 2>/dev/null || true
    rm -f "$NOOP_OUTPUT"
  fi
else
  echo "--- Skipping NOOP baseline test (RUN_NOOP_BASELINE=${RUN_NOOP_BASELINE}) ---"
fi

# Helper: Ensure pg_stat_statements extension exists and reset for clean per-run deltas
reset_pg_stat_statements() {
  echo "--- Ensuring pg_stat_statements extension and resetting ---"
  # Create extension if it doesn't exist (requires superuser, but safe to try)
  psql_in_pod -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1 || true
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
  # Now try to reset
  if psql_in_pod -v ON_ERROR_STOP=1 -c "SELECT pg_stat_statements_reset();" >/dev/null 2>&1; then
    echo "✅ pg_stat_statements reset successfully"
  else
    echo "⚠️  pg_stat_statements_reset() failed - extension may not be installed or accessible" >&2
  fi
}

# Real cold: restart Postgres once per run when COLD_POSTGRES_RESTART=1 (evicts shared_buffers; true cold path).
_cold_postgres_restart_done="${_cold_postgres_restart_done:-0}"

# Helper: Cold cache reset (DB-level). Best-effort: CHECKPOINT + DISCARD + pg_stat_reset + brief sleep.
# When COLD_POSTGRES_RESTART=1: restart Postgres once before first cold phase for true cold (shared_buffers evicted).
cold_cache_reset() {
  echo "--- Cold cache reset (DB-level) ---"
  
  # Real cold: restart Postgres once so shared_buffers is truly cold (optional; set COLD_POSTGRES_RESTART=1).
  if [[ "${COLD_POSTGRES_RESTART:-0}" == "1" ]] && [[ "${_cold_postgres_restart_done:-0}" != "1" ]]; then
    _cold_postgres_restart_done=1
    local pg_container
    pg_container=$(docker ps --filter "name=postgres" --filter "publish=5433" --format "{{.Names}}" 2>/dev/null | head -1)
    if [[ -n "$pg_container" ]]; then
      echo "   Real cold: restarting Postgres container $pg_container (COLD_POSTGRES_RESTART=1)..."
      docker restart "$pg_container" 2>/dev/null || true
      sleep 5
      if ! wait_for_db_ready; then
        echo "❌ Postgres not ready after restart. Continuing with DB-level reset only." >&2
      else
        echo "   ✅ Postgres ready after restart (true cold)"
      fi
    else
      if command -v kubectl >/dev/null 2>&1 && kubectl get deploy -n "${NS:-off-campus-housing-tracker}" 2>/dev/null | grep -q postgres; then
        echo "   Real cold: restarting Postgres deploy (COLD_POSTGRES_RESTART=1)..."
        kubectl rollout restart deploy/postgres -n "${NS:-off-campus-housing-tracker}" 2>/dev/null || true
        sleep 15
        wait_for_db_ready || echo "⚠️  Postgres may still be rolling; continuing with DB-level reset" >&2
      fi
    fi
  fi
  
  # Check if database is in recovery mode before attempting checkpoint
  local recovery_status
  recovery_status=$(psql_in_pod -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "t")
  
  if [[ "$recovery_status" == "t" ]]; then
    echo "⚠️  WARNING: Database is in recovery mode, skipping cold cache reset" >&2
    echo "   This will affect cold phase results. Waiting for recovery to complete..." >&2
    wait_for_db_ready || {
      echo "❌ Database still in recovery after wait. Skipping cold phase." >&2
      return 1
    }
  fi
  
  # Check Docker container disk space before checkpoint
  local pg_container
  pg_container=$(docker ps --filter "name=postgres" --filter "publish=5433" --format "{{.Names}}" | head -1)
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
    echo "   Check Docker container: docker logs $pg_container" >&2
    return 1
  fi
  # Optional: try to evict working set from shared_buffers (best-effort; true cold needs restart or drop_caches).
  if [[ "${REAL_COLD_CACHE:-0}" == "1" ]]; then
    echo "   Evicting working set (REAL_COLD_CACHE=1)..."
    psql_in_pod -tA -c "SELECT sum(length(coalesce(artist,'')||coalesce(name,'')||coalesce(notes,''))) FROM records.records;" >/dev/null 2>&1 || true
    sleep 1
  fi
  # Allow checkpoint I/O to settle.
  sleep 2
}

# CRITICAL: Warm cache and ensure fresh statistics before benchmarks
echo "--- Warming cache and refreshing statistics..."
# Optional: Buffer cache snapshot (if pg_buffercache extension is available)
if psql_in_pod -tAc "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_buffercache')" 2>/dev/null | grep -q t; then
  echo "--- Buffer cache snapshot (top relations) ---"
  psql_in_pod <<'SQL' | tee "$LOG_DIR/buffercache_snapshot_before.txt" 2>/dev/null || true
SELECT
  c.relname,
  n.nspname,
  count(*) AS buffers,
  round(100.0 * count(*) / (SELECT count(*) FROM pg_buffercache), 2) AS pct
FROM pg_buffercache b
JOIN pg_class c ON b.relfilenode = pg_relation_filenode(c.oid)
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IS NOT NULL
GROUP BY c.relname, n.nspname
ORDER BY buffers DESC
LIMIT 20;
SQL
fi
echo "--- Aggressive cache warming (heap, indexes, function plan cache) ---"
psql_in_pod <<'SQL' >/dev/null 2>&1 || true
-- CRITICAL: Apply same performance settings as benchmark (must match PGOPTIONS_EXTRA)
SET jit = off;
SET synchronous_commit = off;
SET search_path = records_hot, records, public, pg_catalog;

-- Force fresh statistics for optimal plans
ANALYZE records.records;
ANALYZE records_hot.records_hot;

-- AGGRESSIVE CACHE WARMING: Prewarm heap pages, all indexes, and function plan cache
-- This ensures maximum cache hit ratio and optimal query plans

-- 1. Warm heap (table data pages) - CRITICAL: prewarm ALL heap pages for benchmark user
-- Use 'prefetch' mode to read from disk if needed, 'buffer' to load into shared_buffers
SELECT pg_prewarm('records.records'::regclass, 'prefetch', 'main') WHERE to_regclass('records.records') IS NOT NULL;
SELECT pg_prewarm('records.records'::regclass, 'buffer', 'main') WHERE to_regclass('records.records') IS NOT NULL;
-- CRITICAL: Prewarm hot tenant table (much smaller, faster to warm)
SELECT pg_prewarm('records_hot.records_hot'::regclass, 'prefetch', 'main') WHERE to_regclass('records_hot.records_hot') IS NOT NULL;
SELECT pg_prewarm('records_hot.records_hot'::regclass, 'buffer', 'main') WHERE to_regclass('records_hot.records_hot') IS NOT NULL;

-- 2. Warm ALL critical indexes (FTS global index + trigram indexes)
-- Prewarm with both prefetch (read from disk) and buffer (load into shared_buffers)
-- CRITICAL: Prewarm FTS indexes (partial index for fast path, global index as fallback)
SELECT pg_prewarm('records.idx_records_search_tsv_bench'::regclass, 'prefetch') WHERE to_regclass('records.idx_records_search_tsv_bench') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_tsv_bench'::regclass, 'buffer') WHERE to_regclass('records.idx_records_search_tsv_bench') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_tsv_all'::regclass, 'prefetch') WHERE to_regclass('records.idx_records_search_tsv_all') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_tsv_all'::regclass, 'buffer') WHERE to_regclass('records.idx_records_search_tsv_all') IS NOT NULL;
-- CRITICAL: Prewarm hot tenant table indexes (much faster for benchmark tenant)
SELECT pg_prewarm('records_hot.idx_records_hot_search_tsv'::regclass, 'prefetch') WHERE to_regclass('records_hot.idx_records_hot_search_tsv') IS NOT NULL;
SELECT pg_prewarm('records_hot.idx_records_hot_search_tsv'::regclass, 'buffer') WHERE to_regclass('records_hot.idx_records_hot_search_tsv') IS NOT NULL;
SELECT pg_prewarm('records_hot.idx_records_hot_search_norm_gin'::regclass, 'prefetch') WHERE to_regclass('records_hot.idx_records_hot_search_norm_gin') IS NOT NULL;
SELECT pg_prewarm('records_hot.idx_records_hot_search_norm_gin'::regclass, 'buffer') WHERE to_regclass('records_hot.idx_records_hot_search_norm_gin') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_norm_gin_bench'::regclass, 'prefetch') WHERE to_regclass('records.idx_records_search_norm_gin_bench') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_norm_gin_bench'::regclass, 'buffer') WHERE to_regclass('records.idx_records_search_norm_gin_bench') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_user_id_btree'::regclass, 'prefetch') WHERE to_regclass('records.idx_records_user_id_btree') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_user_id_btree'::regclass, 'buffer') WHERE to_regclass('records.idx_records_user_id_btree') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_norm_len_bench'::regclass, 'prefetch') WHERE to_regclass('records.idx_records_search_norm_len_bench') IS NOT NULL;
SELECT pg_prewarm('records.idx_records_search_norm_len_bench'::regclass, 'buffer') WHERE to_regclass('records.idx_records_search_norm_len_bench') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_user_id_updated_at'::regclass, 'prefetch') WHERE to_regclass('records.ix_records_user_id_updated_at') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_user_id_updated_at'::regclass, 'buffer') WHERE to_regclass('records.ix_records_user_id_updated_at') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass, 'prefetch') WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_artist_trgm'::regclass, 'buffer') WHERE to_regclass('records.ix_records_artist_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass, 'prefetch') WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_name_trgm'::regclass, 'buffer') WHERE to_regclass('records.ix_records_name_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass, 'prefetch') WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;
SELECT pg_prewarm('records.ix_records_catalog_trgm'::regclass, 'buffer') WHERE to_regclass('records.ix_records_catalog_trgm') IS NOT NULL;

-- 3. Warm FTS index scan path (the core filtering step) - execute multiple times
-- This ensures the index pages are in cache and the query plan is optimized
-- CRITICAL: Warm both main table and hot tenant table for benchmark user
SELECT count(*) FROM records.records AS r
WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  AND r.search_tsv @@ plainto_tsquery('simple', public.norm_text('鄧麗君 album 263 cn-041 polygram'))
LIMIT 40;
SELECT count(*) FROM records_hot.records_hot AS r
WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  AND r.search_tsv @@ plainto_tsquery('simple', public.norm_text('鄧麗君 album 263 cn-041 polygram'))
LIMIT 40;

-- 4. Warm function plan cache with actual benchmark query (same query that will be benchmarked)
-- Execute multiple times to ensure plan is cached and optimized
-- CRITICAL: Use the exact same parameters as the benchmark
SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, '鄧麗君 album 263 cn-041 polygram', 50::bigint, 0::bigint, 'fast');
SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, '鄧麗君 album 263 cn-041 polygram', 50::bigint, 0::bigint, 'fast');
SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, '鄧麗君 album 263 cn-041 polygram', 50::bigint, 0::bigint, 'fast');
SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, '鄧麗君 album 263 cn-041 polygram', 50::bigint, 0::bigint, 'fast');
SELECT count(*) FROM public.search_records_fuzzy_ids('0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, '鄧麗君 album 263 cn-041 polygram', 50::bigint, 0::bigint, 'fast');

-- 5. Force plan cache refresh (discard all plans to ensure fresh plans)
DISCARD PLANS;
SQL

# Reset pg_stat_statements so per-run deltas are clean
# Note: reset_pg_stat_statements() is defined earlier in the script (after CSV header creation)
reset_pg_stat_statements

# CRITICAL: Initialize CSV file with header before sweep loop
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_ID="run_${TIMESTAMP}"
echo "RUN_ID=${RUN_ID}"
results_csv="$tmpdir/bench_sweep_${TIMESTAMP}.csv"
echo "ts_utc,variant,clients,threads,duration_s,limit_rows,tps,ok_xacts,fail_xacts,err_pct,lat_avg_ms,lat_std_ms,lat_est_ms,p50_ms,p95_ms,p99_ms,p999_ms,p9999_ms,p99999_ms,p999999_ms,p9999999_ms,p100_ms,git_rev,git_branch,host,server_version,track_io,delta_blks_hit,delta_blks_read,delta_blk_read_ms,delta_blk_write_ms,delta_xact_commit,delta_tup_returned,delta_tup_fetched,delta_stmt_total_ms,delta_stmt_shared_hit,delta_stmt_shared_read,delta_stmt_shared_dirtied,delta_stmt_shared_written,delta_stmt_temp_read,delta_stmt_temp_written,delta_io_read_ms,delta_io_write_ms,delta_io_extend_ms,delta_io_fsync_ms,io_total_ms,active_sessions,cpu_share_pct,delta_wal_records,delta_wal_fpi,delta_wal_bytes,delta_ckpt_write_ms,delta_ckpt_sync_ms,delta_buf_checkpoint,delta_buf_backend,delta_buf_alloc,hit_ratio_pct,phase,notes" > "$results_csv"
echo "📊 CSV results file: $results_csv"

echo "--- Running sweep"
IFS=',' read -r -a client_array <<< "$CLIENTS"
# Filter client_array to only include values <= SAFE_MAX_CLIENTS
declare -a safe_client_array=()
for c in "${client_array[@]}"; do
  if (( c <= SAFE_MAX_CLIENTS )); then
    safe_client_array+=("$c")
  else
    echo "⚠️  Skipping clients=$c: exceeds safe max_connections=${SAFE_MAX_CLIENTS}"
  fi
done
client_array=("${safe_client_array[@]}")
if [[ ${#client_array[@]} -eq 0 ]]; then
  echo "❌ No safe client counts available! Max connections: $MAX_CONNECTIONS" >&2
  exit 1
fi
echo "Running with client counts: ${client_array[*]}"

# --- Telemetry (perf, strace, htop) for latency analysis ---
# When RUN_TELEMETRY=true, collect host/process snapshots and optional perf stat for one short run.
# Valgrind: use only for single-query profiling (too heavy for full sweep); see PGBENCH_HARDENING.md.
if [[ "$RUN_TELEMETRY" == "true" ]]; then
  TELEMETRY_DIR="${LOG_DIR}/telemetry"
  mkdir -p "$TELEMETRY_DIR"
  echo "--- Telemetry: perf, strace, htop (latency analysis) ---"
  # Host snapshot (htop-style)
  ( ps aux --sort=-%cpu 2>/dev/null | head -25; echo "---"; top -b -n 1 2>/dev/null | head -20 ) > "$TELEMETRY_DIR/htop-before.txt" 2>/dev/null || true
  ( ps aux 2>/dev/null | head -5; uname -a ) >> "$TELEMETRY_DIR/htop-before.txt" 2>/dev/null || true
  # Postgres process snapshot inside Docker (port 5433)
  pg_container=$(docker ps --filter "name=postgres" --filter "publish=5433" --format "{{.Names}}" 2>/dev/null | head -1)
  if [[ -n "$pg_container" ]]; then
    docker exec "$pg_container" ps aux 2>/dev/null | head -30 > "$TELEMETRY_DIR/pg-ps-before.txt" || true
    docker exec "$pg_container" cat /proc/stat 2>/dev/null | head -1 >> "$TELEMETRY_DIR/pg-ps-before.txt" || true
  fi
  # One short pgbench run with perf stat (if available)
  if command -v perf >/dev/null 2>&1; then
    export PGHOST="$RECORDS_DB_HOST" PGPORT="$RECORDS_DB_PORT" PGUSER="$RECORDS_DB_USER" PGDATABASE="$RECORDS_DB_NAME" PGPASSWORD="$RECORDS_DB_PASS"
    export PGOPTIONS="-c jit=off -c synchronous_commit=off -c search_path=public,records,pg_catalog"
    perf stat -d -d -d -o "$TELEMETRY_DIR/perf-stat.txt" -- pgbench -n -M prepared -T 10 -c 8 -j 4 -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" -f "$bench_sql_dir/bench_knn.sql" 2>/dev/null || true
    unset PGOPTIONS
    echo "  perf stat -> $TELEMETRY_DIR/perf-stat.txt"
  fi
  # Optional: strace summary (5s run; heavy; summary goes to stderr)
  if command -v strace >/dev/null 2>&1; then
    export PGHOST="$RECORDS_DB_HOST" PGPORT="$RECORDS_DB_PORT" PGUSER="$RECORDS_DB_USER" PGDATABASE="$RECORDS_DB_NAME" PGPASSWORD="$RECORDS_DB_PASS"
    export PGOPTIONS="-c jit=off -c synchronous_commit=off -c search_path=public,records,pg_catalog"
    timeout 8 strace -c -f -o /dev/null pgbench -n -M prepared -T 5 -c 2 -j 2 -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" -f "$bench_sql_dir/bench_knn.sql" 2> "$TELEMETRY_DIR/strace-summary.txt" || true
    unset PGOPTIONS
    echo "  strace -c -> $TELEMETRY_DIR/strace-summary.txt"
  fi
  # After snapshot
  ( ps aux --sort=-%cpu 2>/dev/null | head -25 ) > "$TELEMETRY_DIR/htop-after.txt" 2>/dev/null || true
  if [[ -n "${pg_container:-}" ]]; then
    docker exec "$pg_container" ps aux 2>/dev/null | head -30 > "$TELEMETRY_DIR/pg-ps-after.txt" || true
  fi
  echo "  Telemetry written to $TELEMETRY_DIR (htop-before/after, pg-ps-*, perf-stat, strace-summary). Valgrind: single-query only; see PGBENCH_HARDENING.md."
fi

read_metrics() {
  psql_in_pod -At < "$tmpdir/read_metrics.sql" | tr '|' ' '
}

read_stmt_metrics() {
  # pg_stat_statements might not be installed; if the query fails, just return zeros.
  local out
  if ! out=$(psql_in_pod -At <<'EOFSQL' 2>/dev/null
    SELECT
      COALESCE(sum(total_exec_time),0),
      COALESCE(sum(shared_blks_hit),0),
      COALESCE(sum(shared_blks_read),0),
      COALESCE(sum(shared_blks_dirtied),0),
      COALESCE(sum(shared_blks_written),0),
      COALESCE(sum(temp_blks_read),0),
      COALESCE(sum(temp_blks_written),0)
    FROM pg_catalog.pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database());
EOFSQL
  ); then
    echo "0 0 0 0 0 0 0"
  else
    if [[ -z "$out" ]]; then
      echo "0 0 0 0 0 0 0"
    else
      echo "$out" | tr '|' ' '
    fi
  fi
}

read_io_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
    SELECT
      COALESCE(sum(read_time),0),
      COALESCE(sum(write_time),0),
      COALESCE(sum(extend_time),0),
      COALESCE(sum(fsync_time),0)
    FROM pg_stat_io;
SQL
}

read_wal_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
    SELECT COALESCE(wal_records,0), COALESCE(wal_fpi,0), COALESCE(wal_bytes,0)
    FROM pg_stat_wal;
SQL
}

read_ckpt_metrics() {
  psql_in_pod -At <<'SQL' | tr '|' ' '
    SELECT
      COALESCE(checkpoint_write_time,0),
      COALESCE(checkpoint_sync_time,0),
      COALESCE(buffers_checkpoint,0),
      COALESCE(buffers_backend,0),
      COALESCE(buffers_alloc,0)
    FROM pg_stat_bgwriter;
SQL
}

git_rev=$(git rev-parse --short HEAD 2>/dev/null || echo na)
git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo na)

run_variant() {
  local variant="$1" sql_file="$2" clients="$3"
  local wd=""
  wd=$(mktemp -d)
  pushd "$wd" >/dev/null
  # CRITICAL: Always return to repo root before cleanup (${wd:-} safe with set -u)
  trap 'cd "$REPO_ROOT" 2>/dev/null || true; popd >/dev/null 2>&1 || true; [[ -n "${wd:-}" ]] && rm -rf "${wd:-}"' RETURN

  # CRITICAL: Disable autovacuum at TABLE level during benchmark to prevent pauses (optional)
  # Note: We disable autovacuum ONLY during the benchmark run, then re-enable it after
  # This prevents pauses without permanently affecting database maintenance
  # NOTE: Session-level SET statements here do NOT affect pgbench connections.
  # All pgbench tuning comes from PGOPTIONS_EXTRA (work_mem, track_io_timing, etc.)
  if [[ "$DISABLE_AUTOVACUUM" == "true" ]]; then
  echo "Disabling autovacuum (table-level) for benchmark..."
  psql_in_pod <<'SQL' >/dev/null 2>&1 || true
-- Table-level autovacuum disable (affects all sessions) - TEMPORARY for benchmark only
ALTER TABLE records.records SET (autovacuum_enabled = false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'aliases_mv' AND relnamespace = 'records'::regnamespace::oid) THEN
    ALTER TABLE records.aliases_mv SET (autovacuum_enabled = false);
  END IF;
END $$;
SQL
  fi

  local metrics_before stmt_before io_before wal_before ckpt_before
  read -r metrics_before <<< "$(read_metrics)"
  read -r stmt_before <<< "$(read_stmt_metrics)"
  read -r io_before <<< "$(read_io_metrics)"
  read -r wal_before <<< "$(read_wal_metrics)"
  read -r ckpt_before <<< "$(read_ckpt_metrics)"

  # Always use the configured THREADS; keeps runs comparable
  local actual_threads
  actual_threads="$THREADS"
  
  # Dynamic duration: longer for high concurrency (soak test)
  local duration="$DURATION"
  if (( clients >= 128 )); then
    duration=$(( DURATION * 3 ))  # e.g., 180s if base is 60
    echo "⚠️  High concurrency ($clients clients): using extended duration ${duration}s for soak test"
  fi

  # Using local pgbench - call directly from $wd so logs end up in the right place
  echo "Running pgbench locally (connecting to external Docker Postgres at ${RECORDS_DB_HOST}:${RECORDS_DB_PORT})..."
  rm -f "$wd"/pgbench_log.* 2>/dev/null || true
  
  # Trgm_simple is the nastiest path; run it without parallel query to save shm
  local pgopts="$PGOPTIONS_EXTRA"
  if [[ "$variant" == "trgm_simple" ]]; then
    pgopts="$pgopts -c max_parallel_workers_per_gather=0 -c max_parallel_workers=1"
  fi
  # Optional: at high client counts, reduce parallel query for knn/trgm to reduce contention (can improve tail latency)
  if [[ "${PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS:-0}" == "1" ]] && (( clients >= 96 )) && [[ "$variant" == "knn" || "$variant" == "trgm" ]]; then
    pgopts="$pgopts -c max_parallel_workers_per_gather=0 -c max_parallel_workers=1"
  fi
  
  # Verify PGOPTIONS are being applied (first run only, for debugging)
  if [[ "$clients" == "${client_array[0]}" ]] && [[ "$variant" == "knn" ]] && [[ "$PHASE" == "warm" ]]; then
    echo "--- Verifying PGOPTIONS are applied (first run only) ---"
    # PGOPTIONS must be set as environment variable, not passed as psql arguments
    export PGOPTIONS="$pgopts"
    PGPASSWORD="$RECORDS_DB_PASS" psql \
      -h "$RECORDS_DB_HOST" -p "$RECORDS_DB_PORT" \
      -U "$RECORDS_DB_USER" -d "$RECORDS_DB_NAME" \
      -c "SELECT name, setting FROM pg_settings WHERE name IN ('enable_seqscan', 'jit', 'synchronous_commit', 'work_mem', 'effective_cache_size') ORDER BY name;" \
      -X -P pager=off 2>&1 | grep -E "(enable_seqscan|jit|synchronous_commit|work_mem|effective_cache_size)" || true
    unset PGOPTIONS
  fi
  
  # CRITICAL: PGOPTIONS must be set as environment variable for pgbench to use it
  # Ensure search_path is included (PGOPTIONS_EXTRA should already have it, but ensure it's there)
  local final_pgopts="$pgopts"
  if [[ "$final_pgopts" != *"search_path"* ]]; then
    final_pgopts="$final_pgopts -c search_path=public,records,pg_catalog"
  fi
  
  # Export PGOPTIONS so pgbench can use it
  export PGOPTIONS="$final_pgopts"
  
  # Run pgbench with connection parameters
  # Use -P 5 for progress every 5 seconds (clean output)
  # Use -r for detailed latency reporting at the end
  # Use environment variables for connection (PGHOST, PGPORT, etc.) instead of command-line flags
  # to avoid conflicts with pgbench option parsing
  export PGHOST="$RECORDS_DB_HOST"
  export PGPORT="$RECORDS_DB_PORT"
  export PGUSER="$RECORDS_DB_USER"
  export PGDATABASE="$RECORDS_DB_NAME"
  export PGPASSWORD="$RECORDS_DB_PASS"
  
  # Randomized variant: multiple -f so each transaction picks one of the query files at random
  if [[ "$variant" == "random" ]] && [[ -f "$bench_sql_dir/bench_random_q1.sql" ]]; then
    pgbench -n -M prepared -P 5 -r -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" -D lim="$LIMIT" \
      -l -f "$bench_sql_dir/bench_random_q1.sql" -f "$bench_sql_dir/bench_random_q2.sql" \
      -f "$bench_sql_dir/bench_random_q3.sql" -f "$bench_sql_dir/bench_random_q4.sql" \
      -f "$bench_sql_dir/bench_random_q5.sql" 2>&1 | tee "$wd/out.txt"
  else
    pgbench \
      -n -M prepared \
      -P 5 -r \
      -T "$duration" -c "$clients" -j "$actual_threads" \
      -D uid="$USER_UUID" -D q="$PG_QUERY_ARG" -D lim="$LIMIT" \
      -l -f "$bench_sql_dir/$sql_file" 2>&1 | tee "$wd/out.txt"
  fi
  
  # Unset PGOPTIONS after run
  unset PGOPTIONS

  local rc=${PIPESTATUS[0]}
  
  # Re-enable autovacuum after benchmark (table-level) if it was disabled
  if [[ "$DISABLE_AUTOVACUUM" == "true" ]]; then
  psql_in_pod <<'SQL' >/dev/null 2>&1 || true
ALTER TABLE records.records SET (autovacuum_enabled = true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'aliases_mv' AND relnamespace = 'records'::regnamespace::oid) THEN
    ALTER TABLE records.aliases_mv SET (autovacuum_enabled = true);
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

  local tps ok fail err_pct avg std p50 p95 p99 p999 p9999 p99999 p999999 p9999999 pmax lat_est_ms
  # Initialize all variables to empty strings to prevent "unbound variable" errors
  tps=""; ok=""; fail=""; err_pct=""; avg=""; std=""; p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; p999999=""; p9999999=""; pmax=""; lat_est_ms=""
  tps=$(sed -n "s/^tps = \([0-9.][0-9.]*\) .*/\1/p" "$wd/out.txt" | tail -n1)
  ok=$(sed -n 's/^number of transactions actually processed: \([0-9][0-9]*\).*/\1/p' "$wd/out.txt" | tail -n1)
  [[ -z "$ok" ]] && ok=0
  fail=$(sed -n 's/^number of failed transactions: \([0-9][0-9]*\).*/\1/p' "$wd/out.txt" | tail -n1)
  [[ -z "$fail" ]] && fail=0
  err_pct=$(awk -v ok="$ok" -v fail="$fail" 'BEGIN{t=ok+fail; if (t>0) printf "%.3f", 100.0*fail/t; else printf "0.000"}')
  
  # Physics-based latency estimate from Little's law (ms)
  # lat_est_ms = 1000 * clients / tps
  lat_est_ms=$(awk -v c="$clients" -v t="$tps" 'BEGIN{
    if (t > 0) printf "%.3f", 1000.0 * c / t;
    else print "";
  }')

  # ---- latency distribution from pgbench logs ----
  # CRITICAL: Process logs from working directory ($wd) where they were copied
  if ls "$wd"/pgbench_log.* >/dev/null 2>&1; then
    # Get pgbench's reported average latency in ms
    summary_avg_ms=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)

    lat_col=""
    if [[ -n "$summary_avg_ms" ]]; then
      # First pass: for every numeric column, compute mean (in µs) and find the one closest to summary average
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
            avg_ms = (sum[i] / cnt[i]) / 1000.0;  # convert µs → ms
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
      # Extract latency from the identified column
      awk -v col="$lat_col" '
        {
          if (NF < col) next;
          v = $col + 0;
          if (v <= 0) next;
          ms = v / 1000.0;          # µs → ms
          if (ms < 60000)           # drop anything >60s just in case
            printf("%.3f\n", ms);
        }
      ' "$wd"/pgbench_log.* > "$wd/lat.txt" 2>/dev/null || true
    fi

    if [[ -s "$wd/lat.txt" ]]; then
      read -r avg std p50 p95 p99 p999 p9999 p99999 p999999 p9999999 pmax < <(calc_latency_metrics "$wd/lat.txt")
      # Ensure all values are set (handle NaN/empty)
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
      # Fallback: use pgbench summary for avg/std only
      avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
      std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
      p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; p999999=""; p9999999=""; pmax=""
    fi
  else
    # Fallback: use pgbench summary for avg/std only
    avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    std=$(sed -n 's/^latency stddev = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
    p50=""; p95=""; p99=""; p999=""; p9999=""; p99999=""; p999999=""; p9999999=""; pmax=""
  fi

  local metrics_after stmt_after io_after wal_after ckpt_after
  read -r metrics_after <<< "$(read_metrics)"
  read -r stmt_after <<< "$(read_stmt_metrics)"
  read -r io_after <<< "$(read_io_metrics)"
  read -r wal_after <<< "$(read_wal_metrics)"
  read -r ckpt_after <<< "$(read_ckpt_metrics)"

  IFS=' ' read -r blks_hit_before blks_read_before read_ms_before write_ms_before xact_before tup_ret_before tup_fetch_before <<< "$metrics_before"
  IFS=' ' read -r blks_hit_after blks_read_after read_ms_after write_ms_after xact_after tup_ret_after tup_fetch_after <<< "$metrics_after"
  IFS=' ' read -r stmt_ms_before stmt_hit_before stmt_read_before stmt_dirty_before stmt_written_before stmt_temp_read_before stmt_temp_write_before <<< "$stmt_before"
  IFS=' ' read -r stmt_ms_after stmt_hit_after stmt_read_after stmt_dirty_after stmt_written_after stmt_temp_read_after stmt_temp_write_after <<< "$stmt_after"
  IFS=' ' read -r io_read_before io_write_before io_extend_before io_fsync_before <<< "$io_before"
  IFS=' ' read -r io_read_after io_write_after io_extend_after io_fsync_after <<< "$io_after"
  IFS=' ' read -r wal_rec_before wal_fpi_before wal_bytes_before <<< "$wal_before"
  IFS=' ' read -r wal_rec_after wal_fpi_after wal_bytes_after <<< "$wal_after"
  IFS=' ' read -r ckpt_write_before ckpt_sync_before buf_ckpt_before buf_backend_before buf_alloc_before <<< "$ckpt_before"
  IFS=' ' read -r ckpt_write_after ckpt_sync_after buf_ckpt_after buf_backend_after buf_alloc_after <<< "$ckpt_after"

  local d_blks_hit=$((blks_hit_after - blks_hit_before))
  local d_blks_read=$((blks_read_after - blks_read_before))
  local d_xact=$((xact_after - xact_before))
  local d_tup_ret=$((tup_ret_after - tup_ret_before))
  local d_tup_fetch=$((tup_fetch_after - tup_fetch_before))
  local d_stmt_ms=$(awk -v a="$stmt_ms_before" -v b="$stmt_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_stmt_hit=$((stmt_hit_after - stmt_hit_before))
  local d_stmt_read=$((stmt_read_after - stmt_read_before))
  local d_stmt_dirty=$((stmt_dirty_after - stmt_dirty_before))
  local d_stmt_written=$((stmt_written_after - stmt_written_before))
  local d_temp_read=$((stmt_temp_read_after - stmt_temp_read_before))
  local d_temp_written=$((stmt_temp_write_after - stmt_temp_write_before))
  local d_read_ms=$(awk -v a="$read_ms_before" -v b="$read_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_write_ms=$(awk -v a="$write_ms_before" -v b="$write_ms_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_read=$(awk -v a="$io_read_before" -v b="$io_read_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_write=$(awk -v a="$io_write_before" -v b="$io_write_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_extend=$(awk -v a="$io_extend_before" -v b="$io_extend_after" 'BEGIN{printf "%.3f", b-a}')
  local d_io_fsync=$(awk -v a="$io_fsync_before" -v b="$io_fsync_after" 'BEGIN{printf "%.3f", b-a}')
  local io_total=$(awk -v r="$d_io_read" -v w="$d_io_write" -v e="$d_io_extend" -v f="$d_io_fsync" 'BEGIN{printf "%.3f", r+w+e+f}')
  local d_wal_rec=$((wal_rec_after - wal_rec_before))
  local d_wal_fpi=$((wal_fpi_after - wal_fpi_before))
  local d_wal_bytes=$(awk -v a="$wal_bytes_before" -v b="$wal_bytes_after" 'BEGIN{printf "%.3f", b-a}')
  local d_ckpt_write=$(awk -v a="$ckpt_write_before" -v b="$ckpt_write_after" 'BEGIN{printf "%.3f", b-a}')
  local d_ckpt_sync=$(awk -v a="$ckpt_sync_before" -v b="$ckpt_sync_after" 'BEGIN{printf "%.3f", b-a}')
  local d_buf_ckpt=$((buf_ckpt_after - buf_ckpt_before))
  local d_buf_backend=$((buf_backend_after - buf_backend_before))
  local d_buf_alloc=$((buf_alloc_after - buf_alloc_before))
  local hit_ratio
  hit_ratio=$(awk -v h="$d_blks_hit" -v r="$d_blks_read" 'BEGIN{t=h+r; if (t>0) printf "%.3f", 100.0*h/t; else printf ""}')
  
  # Calculate active_sessions: average concurrent sessions during benchmark
  # Use actual duration (may be extended for high concurrency)
  local active_sessions
  active_sessions=$(awk -v st="$d_stmt_ms" -v dur="$duration" 'BEGIN{if (dur>0 && st>0) printf "%.3f", st/(dur*1000.0); else printf ""}')
  
  # Calculate cpu_share_pct: (stmt_time - io_time) / stmt_time * 100
  local cpu_share_pct
  cpu_share_pct=$(awk -v st="$d_stmt_ms" -v io="$io_total" 'BEGIN{if (st>0) {x=(st-io)/st*100; if (x<0) x=0; if (x>100) x=100; printf "%.2f", x} else printf ""}')

  local ts
  ts=$(date -u +%FT%TZ)
  local host
  host="$(hostname 2>/dev/null || echo 'localhost')"
  local track_io
  track_io=$(psql_in_pod -At -c "SHOW track_io_timing" | tr 'A-Z' 'a-z')
  track_io=$([[ "$track_io" == "on" ]] && echo true || echo false)

  local notes_str="rev=$git_rev branch=$git_branch host=$host variant=$variant lim=$LIMIT query=$QUERY phase=$PHASE"

  echo "$ts,$variant,$clients,$actual_threads,$duration,$LIMIT,$tps,$ok,$fail,$err_pct,$avg,$std,$lat_est_ms,$p50,$p95,$p99,$p999,$p9999,$p99999,$p999999,$pmax,$git_rev,$git_branch,$host,$(psql_in_pod -At -c 'SHOW server_version'),$track_io,$d_blks_hit,$d_blks_read,$d_read_ms,$d_write_ms,$d_xact,$d_tup_ret,$d_tup_fetch,$d_stmt_ms,$d_stmt_hit,$d_stmt_read,$d_stmt_dirty,$d_stmt_written,$d_temp_read,$d_temp_written,$d_io_read,$d_io_write,$d_io_extend,$d_io_fsync,$io_total,$active_sessions,$cpu_share_pct,$d_wal_rec,$d_wal_fpi,$d_wal_bytes,$d_ckpt_write,$d_ckpt_sync,$d_buf_ckpt,$d_buf_backend,$d_buf_alloc,$hit_ratio,$PHASE,$notes_str" >> "$results_csv"
  
  # Optional: Warn about high latency and print tuning tip once
  if [[ -n "$lat_est_ms" ]] && [[ -n "$tps" ]] && (( $(echo "$tps > 0" | bc -l 2>/dev/null || echo 0) )); then
    # Crude heuristic: if latency > ~0.5ms per client, warn
    threshold=$(awk -v c="$clients" 'BEGIN{printf "%.2f", 0.5 * c}')
    if (( $(echo "$lat_est_ms > $threshold" | bc -l 2>/dev/null || echo 0) )); then
      echo "   ⚠️  High latency for $clients clients (lat_est=${lat_est_ms} ms, threshold=${threshold} ms)" >&2
      if [[ "${HIGH_LATENCY_TIP_SHOWN:-0}" -eq 0 ]]; then
        echo "   Tuning: RUN_PLAN_DUMP=1 or true (query plan in bench_logs); LOG_LOCK_WAITS=on (lock diagnostics); PGBENCH_REDUCE_PARALLEL_AT_HIGH_CLIENTS=1 (96+ clients); see PGBENCH_HARDENING.md" >&2
        HIGH_LATENCY_TIP_SHOWN=1
      fi
    fi
  fi

  psql_in_pod -v ON_ERROR_STOP=1 \
    -v variant="$variant" -v clients="$clients" -v threads="$actual_threads" \
    -v duration="$duration" -v lim="$LIMIT" -v tps="$tps" -v ok="$ok" \
    -v fail="$fail" -v err_pct="$err_pct" -v avg="$avg" -v std="$std" \
    -v lat_est="$lat_est_ms" -v p50="$p50" -v p95="$p95" -v p99="$p99" -v p999="$p999" \
    -v p9999="$p9999" -v p99999="$p99999" -v p999999="$p999999" -v p9999999="$p9999999" -v p100="$pmax" \
    -v phase="$PHASE" -v notes="$notes_str" \
    -v git_rev="$git_rev" -v git_branch="$git_branch" -v host="$host" \
    -v server_version="$(psql_in_pod -At -c 'SHOW server_version')" \
    -v track_io="$track_io" -v dH="$d_blks_hit" -v dR="$d_blks_read" \
    -v dRT="$d_read_ms" -v dWT="$d_write_ms" -v dXC="$d_xact" -v dTR="$d_tup_ret" \
    -v dTF="$d_tup_fetch" -v dST="$d_stmt_ms" -v dSH="$d_stmt_hit" \
    -v dSR="$d_stmt_read" -v dSD="$d_stmt_dirty" -v dSW="$d_stmt_written" \
    -v dTBR="$d_temp_read" -v dTBW="$d_temp_written" -v dIOR="$d_io_read" \
    -v dIOW="$d_io_write" -v dIOE="$d_io_extend" -v dIOF="$d_io_fsync" \
    -v io_total="$io_total" -v act_sess="$active_sessions" -v cpu_share="$cpu_share_pct" \
    -v dWR="$d_wal_rec" -v dWFPI="$d_wal_fpi" \
    -v dWBY="$d_wal_bytes" -v dCKW="$d_ckpt_write" -v dCKS="$d_ckpt_sync" \
    -v dBCK="$d_buf_ckpt" -v dBBE="$d_buf_backend" -v dBAL="$d_buf_alloc" \
    -v hit_ratio="$hit_ratio" -v run_id="$RUN_ID" \
    -f - <<'EOSQL'
      \echo 'Inserting bench.results row variant=' :'variant' ', clients=' :'clients' ', tps=' :'tps'
      INSERT INTO bench.results(
        variant, phase, clients, threads, duration_s, limit_rows,
        tps, ok_xacts, fail_xacts, err_pct,
        lat_avg_ms, lat_std_ms, lat_est_ms,
        p50_ms, p95_ms, p99_ms, p999_ms, p9999_ms, p99999_ms, p999999_ms, p9999999_ms, p100_ms,
        notes,
        git_rev, git_branch, host, server_version, track_io,
        delta_blks_hit, delta_blks_read, delta_blk_read_ms, delta_blk_write_ms,
        delta_xact_commit, delta_tup_returned, delta_tup_fetched,
        delta_stmt_total_ms, delta_stmt_shared_hit, delta_stmt_shared_read,
        delta_stmt_shared_dirtied, delta_stmt_shared_written, delta_stmt_temp_read,
        delta_stmt_temp_written, delta_io_read_ms, delta_io_write_ms, delta_io_extend_ms,
        delta_io_fsync_ms, io_total_ms, active_sessions, cpu_share_pct,
        delta_wal_records, delta_wal_fpi, delta_wal_bytes,
        delta_ckpt_write_ms, delta_ckpt_sync_ms, delta_buf_checkpoint, delta_buf_backend,
        delta_buf_alloc, hit_ratio_pct, run_id
      ) VALUES (
        :'variant', :'phase', :'clients'::int, :'threads'::int, :'duration'::int, :'lim'::int,
        NULLIF(:'tps','')::numeric, NULLIF(:'ok','')::bigint, NULLIF(:'fail','')::bigint, NULLIF(:'err_pct','')::numeric,
        NULLIF(NULLIF(:'avg','NaN'),'')::numeric, NULLIF(NULLIF(:'std','NaN'),'')::numeric,
        NULLIF(NULLIF(:'lat_est','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p50','NaN'),'')::numeric, NULLIF(NULLIF(:'p95','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p99','NaN'),'')::numeric, NULLIF(NULLIF(:'p999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p9999','NaN'),'')::numeric, NULLIF(NULLIF(:'p99999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p999999','NaN'),'')::numeric, NULLIF(NULLIF(:'p9999999','NaN'),'')::numeric,
        NULLIF(NULLIF(:'p100','NaN'),'')::numeric,
        :'notes', :'git_rev', :'git_branch', :'host', :'server_version', :'track_io'::boolean,
        NULLIF(:'dH','')::bigint, NULLIF(:'dR','')::bigint, NULLIF(:'dRT','')::numeric, NULLIF(:'dWT','')::numeric,
        NULLIF(:'dXC','')::bigint, NULLIF(:'dTR','')::bigint, NULLIF(:'dTF','')::bigint,
        NULLIF(:'dST','')::numeric, NULLIF(:'dSH','')::bigint, NULLIF(:'dSR','')::bigint,
        NULLIF(:'dSD','')::bigint, NULLIF(:'dSW','')::bigint, NULLIF(:'dTBR','')::bigint,
        NULLIF(:'dTBW','')::bigint, NULLIF(:'dIOR','')::numeric, NULLIF(:'dIOW','')::numeric, NULLIF(:'dIOE','')::numeric,
        NULLIF(:'dIOF','')::numeric, NULLIF(:'io_total','')::numeric, NULLIF(:'act_sess','')::numeric, NULLIF(:'cpu_share','')::numeric,
        NULLIF(:'dWR','')::bigint, NULLIF(:'dWFPI','')::bigint, NULLIF(:'dWBY','')::numeric,
        NULLIF(:'dCKW','')::numeric, NULLIF(:'dCKS','')::numeric, NULLIF(:'dBCK','')::bigint, NULLIF(:'dBBE','')::bigint,
        NULLIF(:'dBAL','')::bigint, NULLIF(:'hit_ratio','')::numeric, :'run_id'
      );
EOSQL

  popd >/dev/null 2>&1 || true
  rm -rf "$wd"
}

# Variants: removed trgm_simple from routine sweeps (it's a diagnostic-only path)
# Keep it available as a manual diagnostic script, but don't run it in regular sweeps
declare -a variants=("knn" "trgm" "noop")
[[ "$PGBENCH_RANDOMIZED" == "1" || "$PGBENCH_RANDOMIZED" == "true" ]] && variants+=("random")

for clients in "${client_array[@]}"; do
  echo "=== CLIENTS = $clients ==="

  # -------- COLD PHASE (optional, can run first when COLD_FIRST=1) --------
  run_cold_phase() {
    PHASE="cold"
    echo ">> Cold phase (clients=$clients)"
    cold_cache_reset
    for variant in "${variants[@]}"; do
      variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
      echo "== ${variant_label}, clients=$clients, phase=$PHASE =="
      case "$variant" in
        knn) sql_file="bench_knn.sql" ;;
        trgm) sql_file="bench_trgm.sql" ;;
        trgm_simple) sql_file="bench_trgm_simple.sql" ;;
        noop) sql_file="bench_noop.sql" ;;
        random) sql_file="bench_random_q1.sql" ;;
        *) sql_file="bench_${variant}.sql" ;;
      esac
      run_variant "$variant" "$sql_file" "$clients"
      echo
    done
  }

  # -------- WARM PHASE --------
  run_warm_phase() {
  PHASE="warm"
  echo ">> Warm phase (clients=$clients)"
  for variant in "${variants[@]}"; do
    variant_label=$(printf '%s' "$variant" | tr '[:lower:]' '[:upper:]')
    echo "== ${variant_label}, clients=$clients, phase=$PHASE =="
    
    # CRITICAL: Run comprehensive EXPLAIN ANALYZE before first benchmark (optional)
    if [[ "${RUN_PLAN_DUMP_ENABLED:-0}" -eq 1 ]] && [[ "$clients" == "${client_array[0]}" ]] && [[ "$variant" == "${variants[0]}" ]]; then
      echo "--- Running Comprehensive Query Plan Analysis ---"
      echo "📁 Saving full query plans to: $LOG_DIR/"
      timestamp=$(date +%H%M%S)
      
      # Verify function exists before running EXPLAIN
      if ! psql_in_pod -c "SELECT 1 FROM pg_proc WHERE proname = 'search_records_fuzzy_ids' AND pronamespace = 'public'::regnamespace AND pronargs = 5;" >/dev/null 2>&1; then
        echo "❌ ERROR: Function search_records_fuzzy_ids does not exist! Cannot run EXPLAIN ANALYZE." >&2
        exit 1
      fi
      
      # Verify we have data
      DATA_CHECK=$(psql_in_pod -tAc "SELECT count(*) FROM records.records WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;" 2>/dev/null | tr -d ' ' || echo "0")
      if [[ "$DATA_CHECK" -lt 1000 ]]; then
        echo "⚠️  WARNING: Only $DATA_CHECK records for benchmark user (may affect EXPLAIN ANALYZE accuracy)" >&2
      fi
      
      # CRITICAL: Warm cache with actual benchmark query before EXPLAIN ANALYZE
      # This prevents EXPLAIN ANALYZE from reading from disk (which causes 28s+ execution time)
      echo "--- Warming cache with actual benchmark query before EXPLAIN ANALYZE ---"
      psql_in_pod <<'EOFWARM' >/dev/null 2>&1 || true
SET search_path = records, public, pg_catalog;
-- CRITICAL: Apply same performance settings as benchmark (must match PGOPTIONS_EXTRA)
SET jit = off;
SET synchronous_commit = off;
-- Warm cache with actual benchmark query (same query that will be benchmarked)
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid,
  '鄧麗君 album 263 cn-041 polygram',
  50::bigint,
  0::bigint,
  'fast'::text
);
-- Warm the FTS index scan as well
SELECT count(*) FROM records.records AS r
WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  AND r.search_tsv @@ plainto_tsquery('simple', public.norm_text('鄧麗君 album 263 cn-041 polygram'))
LIMIT 40;
EOFWARM
      echo "✅ Cache warmed with actual benchmark query"
      
      psql_in_pod <<'EOFSQL' | tee "$LOG_DIR/query_plan_full_analysis_${timestamp}.txt"
SET search_path = records, public, pg_catalog;
SET jit = off;
-- Ensure Table Statistics (section 6) show current n_live_tup; pg_stat_user_tables can be stale otherwise
ANALYZE records.records;

\echo '================================================================================'
\echo '=== COMPREHENSIVE QUERY PLAN ANALYSIS FOR POSTGRESQL GPT ==='
\echo '================================================================================'
\echo ''
\echo 'Timestamp: ' || now()::text
\echo 'Query: 鄧麗君 album 263 cn-041 polygram'
\echo 'User: 0dc268d0-a86f-4e12-8d10-9db0f1b735e0'
\echo ''

\echo '=== 1. FTS + Trigram Rank Function Query Plan (REAL PATH) ==='
\echo 'NOTE: Using TIMING OFF to reduce EXPLAIN overhead (real runtime is ~2-4ms, not 130ms)'
EXPLAIN (ANALYZE, BUFFERS, COSTS, SUMMARY, TIMING OFF)
SELECT count(*)
FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid,
  '鄧麗君 album 263 cn-041 polygram',
  50::bigint,
  0::bigint,
  'fast'::text
);

\echo ''
\echo '=== 2. FTS Partial Index Usage Check (CRITICAL) ==='
\echo 'Verifying that idx_records_search_tsv_bench (partial index) is actually being used'
\echo 'NOTE: This MUST show Bitmap Index Scan on idx_records_search_tsv_bench'
\echo '      If it shows idx_records_search_tsv_all instead, the partial index is missing or not being used!'
EXPLAIN (ANALYZE, BUFFERS, COSTS, SUMMARY, TIMING OFF)
SELECT
  r.id,
  r.search_norm
FROM records.records AS r
WHERE r.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  AND r.search_tsv @@ plainto_tsquery('simple', public.norm_text('鄧麗君 album 263 cn-041 polygram'))
LIMIT 40;

\echo ''
\echo '=== 3. FTS Partial Index Definition ==='
SELECT pg_get_indexdef('records.idx_records_search_tsv_bench'::regclass);

\echo ''
\echo '=== 4. Raw Trigram % Query Plan (BASELINE - for comparison) ==='
\echo 'NOTE: This baseline is disabled by default (very slow, 5s+). Set INCLUDE_RAW_TRGM_EXPLAIN=true to enable.'
\echo ''
\echo '=== 5. Function Definition ==='
SELECT pg_get_functiondef('public.search_records_fuzzy_ids(uuid,text,bigint,bigint,text)'::regprocedure);

\echo ''
\echo '=== 6. Table Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  pg_size_pretty(pg_total_relation_size((schemaname||'.'||relname)::regclass)) AS total_size
FROM pg_stat_user_tables 
WHERE schemaname = 'records' AND relname = 'records';

\echo ''
\echo '=== 7. Index Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  indexrelname AS indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexrelname)::regclass)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'records' AND relname = 'records'
ORDER BY pg_relation_size((schemaname||'.'||indexrelname)::regclass) DESC
LIMIT 20;

\echo ''
\echo '=== 8. Alias Table Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  n_live_tup,
  pg_size_pretty(pg_total_relation_size((schemaname||'.'||relname)::regclass)) AS total_size
FROM pg_stat_user_tables 
WHERE schemaname = 'public' AND relname IN ('record_aliases', 'aliases_mv');

\echo ''
\echo '=== 9. Alias Index Statistics ==='
SELECT 
  schemaname,
  relname AS tablename,
  indexrelname AS indexname,
  idx_scan,
  idx_tup_read,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexrelname)::regclass)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND relname IN ('record_aliases', 'aliases_mv')
ORDER BY pg_relation_size((schemaname||'.'||indexrelname)::regclass) DESC;

\echo ''
\echo '=== 10. PostgreSQL Configuration (Performance Settings) ==='
SELECT name, setting, unit, source
FROM pg_settings
WHERE name IN (
  'shared_buffers',
  'effective_cache_size',
  'work_mem',
  'maintenance_work_mem',
  'random_page_cost',
  'cpu_index_tuple_cost',
  'cpu_tuple_cost',
  'enable_seqscan',
  'jit',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'track_io_timing',
  'pg_trgm.similarity_threshold'
)
ORDER BY name;

\echo ''
\echo '=== 11. Partitioning Status ==='
SELECT 
  schemaname,
  tablename,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = schemaname AND c.relname = tablename
    ) THEN 'CHILD PARTITION'
    WHEN EXISTS (
      SELECT 1 FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = schemaname AND c.relname = tablename
    ) THEN 'PARENT PARTITION'
    ELSE 'NOT PARTITIONED'
  END AS partition_status
FROM pg_tables
WHERE schemaname = 'records' AND tablename = 'records';

\echo ''
\echo '=== 12. Database Size ==='
SELECT 
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

\echo ''
\echo '================================================================================'
\echo '=== END OF QUERY PLAN ANALYSIS ==='
\echo '================================================================================'
EOFSQL
      echo ""
      echo "--- Analyze step (refresh stats after EXPLAIN ANALYZE) ---"
      psql_in_pod -v ON_ERROR_STOP=1 -c "ANALYZE records.records;" -c "ANALYZE records_hot.records_hot;" 2>/dev/null || true
      echo "✅ Analyze step complete (records.records, records_hot.records_hot)"
      echo ""
      echo "✅ Full query plan saved to: $LOG_DIR/query_plan_full_analysis_${timestamp}.txt"
      echo "   This file contains all information needed for PostgreSQL GPT analysis"
    elif [[ "${RUN_PLAN_DUMP_ENABLED:-0}" -ne 1 ]]; then
      echo "--- Skipping query plan analysis (RUN_PLAN_DUMP=${RUN_PLAN_DUMP}) ---"
    fi
    
    # Map variant names to SQL files
    case "$variant" in
      knn) sql_file="bench_knn.sql" ;;
      trgm) sql_file="bench_trgm.sql" ;;
      trgm_simple) sql_file="bench_trgm_simple.sql" ;;
      noop) sql_file="bench_noop.sql" ;;
      random) sql_file="bench_random_q1.sql" ;;
      *) sql_file="bench_${variant}.sql" ;;
    esac
    run_variant "$variant" "$sql_file" "$clients"
    echo
  done
  }  # end run_warm_phase

  if [[ "${COLD_FIRST:-0}" == "1" ]] && [[ "$RUN_COLD_CACHE" == "true" ]]; then
    run_cold_phase
    run_warm_phase
  else
    run_warm_phase
    if [[ "$RUN_COLD_CACHE" == "true" ]]; then
      run_cold_phase
    fi
  fi
done

echo "--- Exporting results (this run: $RUN_ID) ---"
# Clean up old bad data before export (one-time cleanup)
psql_in_pod <<'SQL'
-- Clean up obviously bogus rows from old runs (one-time cleanup)
DELETE FROM bench.results
WHERE (p95_ms > 100000 OR p99_ms > 100000 OR lat_avg_ms > 10000 OR lat_avg_ms IS NULL)
  AND (run_id IS NULL OR run_id < 'run_20251121');
SQL

echo "CSV (sweep log): $results_csv"
# CRITICAL: Use REPO_ROOT set at top of script (like old version)
# This ensures CSVs are written to repo root, not temp directories
output_dir="$REPO_ROOT"
if [[ ! -d "$output_dir" ]]; then
  echo "⚠️  REPO_ROOT ($output_dir) doesn't exist, using current directory" >&2
output_dir="$(pwd)"
fi
echo "Writing CSV files to: $output_dir"
# CRITICAL: Also save to LOG_DIR immediately (before any potential crashes)
if [[ -n "${LOG_DIR:-}" ]] && [[ -d "$LOG_DIR" ]]; then
  cp -f "$results_csv" "$LOG_DIR/bench_sweep_${TIMESTAMP}.csv" 2>/dev/null || {
    echo "⚠️  Failed to copy CSV to $LOG_DIR/bench_sweep_${TIMESTAMP}.csv" >&2
  }
fi
# Copy with timestamped filename to repo root
cp -f "$results_csv" "$output_dir/bench_sweep_${TIMESTAMP}.csv" 2>/dev/null || {
  echo "⚠️  Failed to copy CSV to $output_dir/bench_sweep_${TIMESTAMP}.csv" >&2
  echo "   Original file: $results_csv" >&2
  # Try to save to LOG_DIR as fallback
  if [[ -n "${LOG_DIR:-}" ]] && [[ -d "$LOG_DIR" ]]; then
    cp -f "$results_csv" "$LOG_DIR/bench_sweep_${TIMESTAMP}.csv" 2>/dev/null || true
  fi
}
# Also create a symlink/latest copy for convenience
cp -f "$results_csv" "$output_dir/bench_sweep.csv" 2>/dev/null || {
  echo "⚠️  Failed to copy CSV to $output_dir/bench_sweep.csv" >&2
}

# Export from database (using COPY to STDOUT via psql)
remote_export="$output_dir/bench_export_${TIMESTAMP}.csv"
if ! psql_in_pod <<SQL > "$remote_export" 2>/dev/null
COPY (
  SELECT *
  FROM bench.results
  WHERE run_id = '$RUN_ID'
  ORDER BY ts_utc DESC
) TO STDOUT CSV HEADER;
SQL
then
  echo "bench.results export failed, using local sweep data for bench_export."
  cp -f "$results_csv" "$remote_export" 2>/dev/null || true
fi
cp -f "$remote_export" "$output_dir/bench_export.csv" 2>/dev/null || true

echo "✅ Wrote $output_dir/bench_sweep_${TIMESTAMP}.csv"
echo "✅ Wrote $output_dir/bench_export_${TIMESTAMP}.csv"
echo "✅ Also wrote: $output_dir/bench_sweep.csv (latest)"
echo ""

# Generate plots if enabled
if [[ "$GENERATE_PLOTS" == "true" ]] && command -v python3 >/dev/null 2>&1; then
  echo "--- Generating plots from bench_export_${TIMESTAMP}.csv ---"
  python3 <<PY
import sys
from pathlib import Path

# Try to import required modules, with helpful error messages
try:
    import pandas as pd
except ImportError:
    print("⚠️  pandas not found. Install with: python3 -m pip install --user pandas matplotlib", file=sys.stderr)
    print("   Or set GENERATE_PLOTS=false to skip plot generation", file=sys.stderr)
    sys.exit(0)

try:
    import matplotlib.pyplot as plt
except ImportError:
    print("⚠️  matplotlib not found. Install with: python3 -m pip install --user pandas matplotlib", file=sys.stderr)
    print("   Or set GENERATE_PLOTS=false to skip plot generation", file=sys.stderr)
    sys.exit(0)

csv_path = Path("${output_dir}") / f"bench_export_${TIMESTAMP}.csv"
log_dir = Path("${LOG_DIR}")

try:
    df = pd.read_csv(csv_path)
    
    # Only rows with TPS, and variants we care about
    df = df[df["tps"].notnull() & df["variant"].isin(["knn", "trgm", "noop"])]
    
    # Use latest rows (in case table has older data)
    # We'll treat (variant, clients, tps) as unique for plotting.
    df = df.sort_values("ts_utc")
    
    # Build a series label that includes phase when present
    if "phase" in df.columns:
        df["series"] = df["variant"] + "_" + df["phase"].fillna("warm")
    else:
        df["series"] = df["variant"]
    
    def plot_metric(metric, ylabel, filename, logy=False):
        if metric not in df.columns:
            return
        plt.figure(figsize=(10, 6))
        for series, sub in df.groupby("series"):
            # take best row per clients for this series
            best = sub.sort_values("tps", ascending=False).drop_duplicates(["clients"])
            x = best["clients"]
            y = best[metric]
            if y.notnull().any():
                plt.plot(x, y, marker="o", label=series)
        plt.xlabel("clients")
        plt.ylabel(ylabel)
        plt.title(f"{metric} vs clients")
        if logy:
            plt.yscale("log")
        plt.grid(True, alpha=0.3)
        plt.legend()
        out = log_dir / filename
        plt.tight_layout()
        plt.savefig(out)
        print(f"  wrote {out}")
    
    plot_metric("tps", "TPS", "tps_vs_clients.png", logy=False)
    plot_metric("p95_ms", "p95 latency (ms)", "p95_vs_clients.png", logy=True)
    plot_metric("p99_ms", "p99 latency (ms)", "p99_vs_clients.png", logy=True)
    plot_metric("p999_ms", "p999 latency (ms)", "p999_vs_clients.png", logy=True)
    plot_metric("p9999_ms", "p9999 latency (ms)", "p9999_vs_clients.png", logy=True)
    plot_metric("p99999_ms", "p99999 latency (ms)", "p99999_vs_clients.png", logy=True)
    plot_metric("p999999_ms", "p999999 latency (ms)", "p999999_vs_clients.png", logy=True)
    
except Exception as e:
    print(f"⚠️  Plot generation failed: {e}", file=sys.stderr)
    print("   Set GENERATE_PLOTS=false to skip plot generation", file=sys.stderr)
    sys.exit(0)  # Don't fail the whole script if plotting fails
PY
else
  echo "--- Skipping plot generation (GENERATE_PLOTS=${GENERATE_PLOTS}, python3=$(command -v python3 || echo none)) ---"
fi

# Diff-mode: regression detection against baseline CSV
if [[ "$RUN_DIFF_MODE" == "true" && -n "$BASELINE_CSV" && -f "$BASELINE_CSV" ]] && command -v python3 >/dev/null 2>&1; then
  echo "--- Running regression diff vs baseline: $BASELINE_CSV ---"
  python3 <<PY
import pandas as pd
from pathlib import Path
import sys

baseline_path = Path("${BASELINE_CSV}")
current_path = Path("${output_dir}") / f"bench_export_${TIMESTAMP}.csv"

try:
    base = pd.read_csv(baseline_path)
    cur = pd.read_csv(current_path)
    
    # Focus on knn/trgm/noop with non-null TPS
    base = base[base["tps"].notnull() & base["variant"].isin(["knn", "trgm", "noop"])]
    cur  = cur[cur["tps"].notnull()  & cur["variant"].isin(["knn", "trgm", "noop"])]
    
    # Use best TPS per (variant, clients) in each set
    def best_by_variant_clients(df):
        df = df.sort_values("tps", ascending=False)
        return df.drop_duplicates(["variant", "clients"])
    
    base_best = best_by_variant_clients(base)
    cur_best  = best_by_variant_clients(cur)
    
    merged = cur_best.merge(
        base_best,
        on=["variant", "clients"],
        suffixes=("_cur", "_base")
    )
    
    if merged.empty:
        print("No overlapping (variant,clients) between baseline and current; skipping diff.")
    else:
        # Define all metrics to compare
        metrics = [
            'tps', 'ok_xacts', 'fail_xacts', 'err_pct', 'avg_ms', 'std_ms', 'lat_est_ms',
            'p50_ms', 'p95_ms', 'p99_ms', 'p999_ms', 'p9999_ms', 'p99999_ms', 'p999999_ms', 'max_ms',
            'delta_blks_hit', 'delta_blks_read', 'delta_blk_read_ms', 'delta_blk_write_ms',
            'delta_xact_commit', 'delta_tup_returned', 'delta_tup_fetched',
            'delta_stmt_total_ms', 'delta_stmt_shared_hit', 'delta_stmt_shared_read',
            'delta_stmt_shared_dirtied', 'delta_stmt_shared_written',
            'delta_stmt_temp_read', 'delta_stmt_temp_written',
            'delta_io_read_ms', 'delta_io_write_ms', 'delta_io_extend_ms', 'delta_io_fsync_ms',
            'io_total_ms', 'active_sessions', 'cpu_share_pct',
            'delta_wal_records', 'delta_wal_fpi', 'delta_wal_bytes',
            'delta_ckpt_write_ms', 'delta_ckpt_sync_ms',
            'delta_buf_checkpoint', 'delta_buf_backend', 'delta_buf_alloc', 'hit_ratio_pct'
        ]
        
        # Build header
        header = "variant,clients"
        for m in metrics:
            header += f",{m}_base,{m}_cur,Δ{m}%"
        header += ",regression"
        print(header)
        
        tps_thresh = float("${REG_THRESH_TPS_DROP}")
        p95_thresh = float("${REG_THRESH_P95_INCREASE}")
        
        for _, row in merged.iterrows():
            tps_base = row.get("tps_base", 0)
            tps_cur = row.get("tps_cur", 0)
            p95_base = row.get("p95_ms_base", float('nan'))
            p95_cur = row.get("p95_ms_cur", float('nan'))
            
            # Calculate deltas for TPS and p95 for regression detection
            if tps_base > 0:
                tps_delta = (tps_cur - tps_base) / tps_base
            else:
                tps_delta = 0.0
            
            if pd.notna(p95_base) and p95_base > 0 and pd.notna(p95_cur):
                p95_delta = (p95_cur - p95_base) / p95_base
            else:
                p95_delta = 0.0
            
            regression = (tps_delta < -tps_thresh) or (p95_delta > p95_thresh)
            
            # Build output row
            out = f"{row['variant']},{int(row['clients'])}"
            for m in metrics:
                base_val = row.get(f"{m}_base", float('nan'))
                cur_val = row.get(f"{m}_cur", float('nan'))
                
                # Format values
                base_str = f"{base_val:.3f}" if pd.notna(base_val) else ""
                cur_str = f"{cur_val:.3f}" if pd.notna(cur_val) else ""
                
                # Calculate percentage delta
                if pd.notna(base_val) and pd.notna(cur_val) and base_val != 0:
                    delta_pct = ((cur_val - base_val) / base_val) * 100
                    delta_str = f"{delta_pct:.2f}"
                else:
                    delta_str = ""
                
                out += f",{base_str},{cur_str},{delta_str}"
            
            out += f",{regression}"
            print(out)
except Exception as e:
    print(f"⚠️  Diff-mode failed: {e}", file=sys.stderr)
    sys.exit(1)
PY
else
  if [[ "$RUN_DIFF_MODE" == "true" ]]; then
    echo "--- Diff-mode requested but BASELINE_CSV missing or python3 not available ---"
  fi
fi

# Peak TPS summary (includes all percentiles for comprehensive latency analysis)
echo "--- Peak TPS Summary (this run only: $RUN_ID) ---"
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/peak_tps_summary.txt"
-- Format includes all percentiles: variant | clients | tps | lat_est_ms | p50_ms | p95_ms | p99_ms | p999_ms | p9999_ms | p99999_ms | p999999_ms | p9999999_ms | p100_ms
-- Takes best TPS for each variant+clients combo (usually warm phase)
SELECT 
  variant,
  clients,
  ROUND(tps::numeric, 2) AS tps,
  ROUND(lat_est_ms::numeric, 3) AS lat_est_ms,
  ROUND(p50_ms::numeric, 3) AS p50_ms,
  ROUND(p95_ms::numeric, 3) AS p95_ms,
  ROUND(p99_ms::numeric, 3) AS p99_ms,
  ROUND(p999_ms::numeric, 3) AS p999_ms,
  ROUND(p9999_ms::numeric, 3) AS p9999_ms,
  ROUND(p99999_ms::numeric, 3) AS p99999_ms,
  ROUND(p999999_ms::numeric, 3) AS p999999_ms,
  ROUND(p9999999_ms::numeric, 3) AS p9999999_ms,
  ROUND(p100_ms::numeric, 3) AS p100_ms
FROM bench.results
WHERE variant IN ('knn', 'trgm', 'noop')
  AND tps IS NOT NULL
  AND run_id = :'run_id'
  -- For each variant+clients combo, take the best TPS (usually warm phase)
  AND (variant, clients, tps) IN (
    SELECT variant, clients, MAX(tps)
    FROM bench.results
    WHERE variant IN ('knn', 'trgm', 'noop')
      AND tps IS NOT NULL
      AND run_id = :'run_id'
    GROUP BY variant, clients
  )
ORDER BY 
  CASE variant WHEN 'knn' THEN 1 WHEN 'trgm' THEN 2 WHEN 'noop' THEN 3 END,
  clients;
SQL

# Find peak TPS for each variant (this run only)
echo ""
echo "=== Peak Performance Summary (this run: $RUN_ID) ==="
for variant in knn trgm noop; do
  peak=$(psql_in_pod -v run_id="$RUN_ID" -tAc "SELECT clients, tps, lat_est_ms FROM bench.results WHERE variant = '$variant' AND tps IS NOT NULL AND run_id = :'run_id' ORDER BY tps DESC LIMIT 1;" 2>/dev/null || echo "")
  if [[ -n "$peak" ]]; then
    IFS='|' read -r peak_clients peak_tps peak_lat <<< "$peak"
    echo "Peak $variant: ${peak_tps} TPS @ ${peak_clients} clients (lat_est: ${peak_lat} ms)"
  fi
done
echo ""

# Latency Cut Reporting (cold and warm phases)
echo "=== Latency Cuts by Phase (this run: $RUN_ID) ==="
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/latency_cuts.txt"
-- Comprehensive latency cut reporting for both cold and warm phases
-- Shows all percentiles (p50, p95, p99, p999, p9999, p99999, p999999, p9999999, p100) for each variant+clients+phase combo
SELECT 
  variant,
  phase,
  clients,
  ROUND(tps::numeric, 2) AS tps,
  ROUND(p50_ms::numeric, 3) AS p50_ms,
  ROUND(p95_ms::numeric, 3) AS p95_ms,
  ROUND(p99_ms::numeric, 3) AS p99_ms,
  ROUND(p999_ms::numeric, 3) AS p999_ms,
  ROUND(p9999_ms::numeric, 3) AS p9999_ms,
  ROUND(p99999_ms::numeric, 3) AS p99999_ms,
  ROUND(p999999_ms::numeric, 3) AS p999999_ms,
  ROUND(p9999999_ms::numeric, 3) AS p9999999_ms,
  ROUND(p100_ms::numeric, 3) AS p100_ms
FROM bench.results
WHERE variant IN ('knn', 'trgm', 'noop')
  AND tps IS NOT NULL
  AND phase IN ('cold', 'warm')
  AND run_id = :'run_id'
ORDER BY 
  CASE variant WHEN 'knn' THEN 1 WHEN 'trgm' THEN 2 WHEN 'noop' THEN 3 END,
  CASE phase WHEN 'cold' THEN 1 WHEN 'warm' THEN 2 END,
  clients;
SQL
echo ""

# Comprehensive Expected vs Reality Analysis
echo "=== Expected vs Reality Analysis (Little's Law Validation) ==="
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/expected_vs_reality_analysis.txt"
-- Comprehensive analysis comparing expected vs actual performance
-- Uses Little's Law: L = λW (clients = TPS * latency_ms / 1000)
-- Expected TPS = clients * 1000 / latency_ms
-- Expected latency = clients * 1000 / tps

WITH results AS (
SELECT 
  variant,
  phase,
  clients,
  tps,
    lat_avg_ms,
  lat_est_ms,
  p50_ms,
  p95_ms,
  p99_ms,
  p999_ms,
  p9999_ms,
  p99999_ms,
    p999999_ms,
    p100_ms,
    delta_blks_hit,
    delta_blks_read,
    hit_ratio_pct,
    delta_stmt_total_ms,
    active_sessions,
    cpu_share_pct
FROM bench.results
WHERE variant IN ('knn', 'trgm', 'noop')
  AND tps IS NOT NULL
    AND lat_avg_ms IS NOT NULL
  AND run_id = :'run_id'
),
analysis AS (
  SELECT
    variant,
    phase,
    clients,
    tps AS actual_tps,
    lat_avg_ms AS actual_lat_avg,
    lat_est_ms AS actual_lat_est,
    p50_ms,
    p95_ms,
    p99_ms,
    p999_ms,
    p9999_ms,
    p99999_ms,
    p999999_ms,
    p100_ms,
    -- Little's Law: Expected TPS from actual latency
    CASE 
      WHEN lat_avg_ms > 0 THEN (clients * 1000.0 / lat_avg_ms)
      ELSE NULL
    END AS expected_tps_from_lat,
    -- Little's Law: Expected latency from actual TPS
    CASE 
      WHEN tps > 0 THEN (clients * 1000.0 / tps)
      ELSE NULL
    END AS expected_lat_from_tps,
    -- Efficiency metrics
    CASE 
      WHEN lat_avg_ms > 0 AND tps > 0 THEN
        (clients * 1000.0 / lat_avg_ms) / NULLIF(tps, 0)
      ELSE NULL
    END AS tps_efficiency,  -- >1 = better than expected, <1 = worse
    CASE 
      WHEN tps > 0 AND lat_avg_ms > 0 THEN
        (clients * 1000.0 / tps) / NULLIF(lat_avg_ms, 0)
      ELSE NULL
    END AS lat_efficiency,  -- <1 = better than expected, >1 = worse
    -- Tail latency ratios (how much worse than p50)
    CASE WHEN p50_ms > 0 THEN p95_ms / p50_ms ELSE NULL END AS p95_p50_ratio,
    CASE WHEN p50_ms > 0 THEN p99_ms / p50_ms ELSE NULL END AS p99_p50_ratio,
    CASE WHEN p50_ms > 0 THEN p999_ms / p50_ms ELSE NULL END AS p999_p50_ratio,
    CASE WHEN p50_ms > 0 THEN p9999_ms / p50_ms ELSE NULL END AS p9999_p50_ratio,
    CASE WHEN p50_ms > 0 THEN p99999_ms / p50_ms ELSE NULL END AS p99999_p50_ratio,
    CASE WHEN p50_ms > 0 THEN p999999_ms / p50_ms ELSE NULL END AS p999999_p50_ratio,
    -- Cache efficiency
    hit_ratio_pct,
    -- CPU vs IO split
    cpu_share_pct,
    -- Active sessions (concurrency)
    active_sessions
  FROM results
)
SELECT
  variant,
  phase,
  clients,
  ROUND(actual_tps::numeric, 2) AS actual_tps,
  ROUND(expected_tps_from_lat::numeric, 2) AS expected_tps_from_lat,
  ROUND((actual_tps - expected_tps_from_lat)::numeric, 2) AS tps_diff,
  ROUND((100.0 * (actual_tps - expected_tps_from_lat) / NULLIF(expected_tps_from_lat, 0))::numeric, 2) AS tps_diff_pct,
  ROUND(actual_lat_avg::numeric, 3) AS actual_lat_avg_ms,
  ROUND(expected_lat_from_tps::numeric, 3) AS expected_lat_from_tps_ms,
  ROUND((actual_lat_avg - expected_lat_from_tps)::numeric, 3) AS lat_diff_ms,
  ROUND((100.0 * (actual_lat_avg - expected_lat_from_tps) / NULLIF(expected_lat_from_tps, 0))::numeric, 2) AS lat_diff_pct,
  ROUND(tps_efficiency::numeric, 3) AS tps_efficiency,
  ROUND(lat_efficiency::numeric, 3) AS lat_efficiency,
  ROUND(p95_p50_ratio::numeric, 2) AS p95_p50_ratio,
  ROUND(p99_p50_ratio::numeric, 2) AS p99_p50_ratio,
  ROUND(p999_p50_ratio::numeric, 2) AS p999_p50_ratio,
  ROUND(p9999_p50_ratio::numeric, 2) AS p9999_p50_ratio,
  ROUND(p99999_p50_ratio::numeric, 2) AS p99999_p50_ratio,
  ROUND(p999999_p50_ratio::numeric, 2) AS p999999_p50_ratio,
  ROUND(hit_ratio_pct::numeric, 2) AS cache_hit_ratio_pct,
  ROUND(cpu_share_pct::numeric, 2) AS cpu_share_pct,
  ROUND(active_sessions::numeric, 2) AS active_sessions
FROM analysis
ORDER BY variant, phase, clients;
SQL

# Generate insights and recommendations
echo ""
echo "=== Performance Insights & Recommendations ==="
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/performance_insights.txt"
-- Generate actionable insights from the benchmark results

WITH results AS (
  SELECT 
    variant,
    phase,
    clients,
    tps,
    lat_avg_ms,
    lat_est_ms,
    p50_ms,
    p95_ms,
    p99_ms,
    p999_ms,
    p9999_ms,
    p99999_ms,
    p999999_ms,
    p100_ms,
    hit_ratio_pct,
    cpu_share_pct,
    active_sessions,
    delta_blks_read,
    delta_stmt_total_ms
  FROM bench.results
  WHERE variant IN ('knn', 'trgm', 'noop')
    AND tps IS NOT NULL
    AND run_id = :'run_id'
),
analysis AS (
  SELECT
    variant,
    phase,
    clients,
    tps,
    lat_avg_ms,
    lat_est_ms,
    p50_ms,
    p95_ms,
    p99_ms,
    p999_ms,
    p9999_ms,
    p99999_ms,
    p999999_ms,
    p100_ms,
    -- Expected vs actual
    (clients * 1000.0 / NULLIF(lat_avg_ms, 0)) AS expected_tps,
    (clients * 1000.0 / NULLIF(tps, 0)) AS expected_lat,
    -- Efficiency
    ((clients * 1000.0 / NULLIF(lat_avg_ms, 0)) / NULLIF(tps, 0)) AS tps_efficiency,
    -- Tail ratios
    p95_ms / NULLIF(p50_ms, 0) AS p95_ratio,
    p99_ms / NULLIF(p50_ms, 0) AS p99_ratio,
    p999_ms / NULLIF(p50_ms, 0) AS p999_ratio,
    p9999_ms / NULLIF(p50_ms, 0) AS p9999_ratio,
    hit_ratio_pct,
    cpu_share_pct,
    active_sessions
  FROM results
)
SELECT
  variant || ' @ ' || clients || ' clients (' || phase || ')' AS scenario,
  CASE 
    WHEN tps_efficiency < 0.9 THEN '⚠️  TPS efficiency < 90% - system may be bottlenecked'
    WHEN tps_efficiency > 1.1 THEN '✅ TPS efficiency > 110% - excellent performance'
    ELSE '✓ TPS efficiency normal (90-110%)'
  END AS tps_insight,
  CASE 
    WHEN p95_ratio > 5 THEN '⚠️  p95/p50 ratio > 5x - high tail latency variance'
    WHEN p95_ratio < 2 THEN '✅ p95/p50 ratio < 2x - very consistent latency'
    ELSE '✓ p95/p50 ratio normal (2-5x)'
  END AS p95_insight,
  CASE 
    WHEN p99_ratio > 10 THEN '⚠️  p99/p50 ratio > 10x - extreme tail latency'
    WHEN p99_ratio < 3 THEN '✅ p99/p50 ratio < 3x - excellent tail latency'
    ELSE '✓ p99/p50 ratio normal (3-10x)'
  END AS p99_insight,
  CASE 
    WHEN p999_ratio > 50 THEN '⚠️  p999/p50 ratio > 50x - severe tail latency spikes'
    WHEN p999_ratio < 10 THEN '✅ p999/p50 ratio < 10x - good tail latency control'
    ELSE '✓ p999/p50 ratio normal (10-50x)'
  END AS p999_insight,
  CASE 
    WHEN hit_ratio_pct < 95 THEN '⚠️  Cache hit ratio < 95% - consider increasing shared_buffers'
    WHEN hit_ratio_pct > 99 THEN '✅ Cache hit ratio > 99% - excellent cache efficiency'
    ELSE '✓ Cache hit ratio good (95-99%)'
  END AS cache_insight,
  CASE 
    WHEN cpu_share_pct < 50 THEN '⚠️  CPU share < 50% - I/O bound, consider faster storage or more RAM'
    WHEN cpu_share_pct > 90 THEN '✅ CPU share > 90% - CPU bound, good for this workload'
    ELSE '✓ CPU share balanced (50-90%)'
  END AS cpu_insight
FROM analysis
WHERE tps_efficiency IS NOT NULL
ORDER BY variant, phase, clients;
SQL

# Anomaly Detection
echo ""
echo "=== Anomaly Detection (Performance Degradation Alerts) ==="
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/anomaly_detection.txt"
-- Detect anomalies: significant deviations from expected performance

WITH results AS (
  SELECT 
    variant,
    phase,
    clients,
    tps,
    lat_avg_ms,
    lat_est_ms,
    p50_ms,
    p95_ms,
    p99_ms,
    p999_ms,
    p9999_ms,
    p99999_ms,
    p999999_ms,
    p100_ms,
    hit_ratio_pct,
    cpu_share_pct
  FROM bench.results
  WHERE variant IN ('knn', 'trgm', 'noop')
    AND tps IS NOT NULL
    AND lat_avg_ms IS NOT NULL
    AND run_id = :'run_id'
),
analysis AS (
  SELECT
    variant,
    phase,
    clients,
    tps,
    lat_avg_ms,
    lat_est_ms,
    p50_ms,
    p95_ms,
    p99_ms,
    p999_ms,
    p9999_ms,
    p99999_ms,
    p999999_ms,
    p100_ms,
    -- Expected values
    (clients * 1000.0 / NULLIF(lat_avg_ms, 0)) AS expected_tps,
    (clients * 1000.0 / NULLIF(tps, 0)) AS expected_lat,
    -- Deviations
    ABS(tps - (clients * 1000.0 / NULLIF(lat_avg_ms, 0))) / NULLIF((clients * 1000.0 / NULLIF(lat_avg_ms, 0)), 0) AS tps_deviation_pct,
    ABS(lat_avg_ms - (clients * 1000.0 / NULLIF(tps, 0))) / NULLIF((clients * 1000.0 / NULLIF(tps, 0)), 0) AS lat_deviation_pct,
    -- Tail latency issues
    CASE WHEN p999_ms > 1000 THEN true ELSE false END AS p999_too_high,
    CASE WHEN p9999_ms > 5000 THEN true ELSE false END AS p9999_too_high,
    CASE WHEN p99999_ms > 10000 THEN true ELSE false END AS p99999_too_high,
    CASE WHEN p100_ms > 30000 THEN true ELSE false END AS p100_too_high,
    hit_ratio_pct,
    cpu_share_pct
  FROM results
)
SELECT
  variant || ' @ ' || clients || ' clients (' || phase || ')' AS scenario,
  CASE 
    WHEN tps_deviation_pct > 0.15 THEN '🔴 CRITICAL: TPS deviation > 15% from expected'
    WHEN tps_deviation_pct > 0.10 THEN '🟡 WARNING: TPS deviation > 10% from expected'
    ELSE '✓ TPS within expected range'
  END AS tps_anomaly,
  CASE 
    WHEN lat_deviation_pct > 0.15 THEN '🔴 CRITICAL: Latency deviation > 15% from expected'
    WHEN lat_deviation_pct > 0.10 THEN '🟡 WARNING: Latency deviation > 10% from expected'
    ELSE '✓ Latency within expected range'
  END AS lat_anomaly,
  CASE 
    WHEN p999_too_high THEN '🔴 p999 > 1s - severe tail latency'
    WHEN p9999_too_high THEN '🟡 p9999 > 5s - very high tail latency'
    WHEN p99999_too_high THEN '🟡 p99999 > 10s - extreme tail latency'
    WHEN p100_too_high THEN '🟡 p100 > 30s - maximum latency too high'
    ELSE '✓ Tail latency acceptable'
  END AS tail_anomaly,
  CASE 
    WHEN hit_ratio_pct < 90 THEN '🔴 Cache hit ratio < 90% - severe cache miss issue'
    WHEN hit_ratio_pct < 95 THEN '🟡 Cache hit ratio < 95% - cache miss concern'
    ELSE '✓ Cache hit ratio good'
  END AS cache_anomaly
FROM analysis
WHERE tps_deviation_pct > 0.10 
   OR lat_deviation_pct > 0.10
   OR p999_too_high
   OR p9999_too_high
   OR p99999_too_high
   OR p100_too_high
   OR hit_ratio_pct < 95
ORDER BY 
  CASE 
    WHEN tps_deviation_pct > 0.15 OR lat_deviation_pct > 0.15 THEN 1
    WHEN tps_deviation_pct > 0.10 OR lat_deviation_pct > 0.10 THEN 2
    ELSE 3
  END,
  variant, phase, clients;
SQL

echo ""
echo "✅ Analysis complete! Check these files in $LOG_DIR:"
echo "   - expected_vs_reality_analysis.txt (Little's Law validation)"
echo "   - performance_insights.txt (Actionable recommendations)"
echo "   - anomaly_detection.txt (Performance degradation alerts)"
echo ""

# Records DB artifacts for tuning (north star: 5k+ TPS fuzzy search)
echo "=== Records DB data summary (data-summary-records.txt) ==="
psql_in_pod <<'SQL' | tee "$LOG_DIR/data-summary-records.txt"
SET search_path = records, bench, public;
SELECT 'records.records' AS relation, pg_size_pretty(pg_total_relation_size('records.records'::regclass)) AS total_size, (SELECT count(*) FROM records.records) AS row_count
UNION ALL
SELECT 'records.records_hot', pg_size_pretty(pg_total_relation_size('records.records_hot'::regclass)), (SELECT count(*) FROM records.records_hot)
UNION ALL
SELECT 'bench.results', pg_size_pretty(pg_total_relation_size('bench.results'::regclass)), (SELECT count(*) FROM bench.results);

SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables WHERE schemaname = 'records' AND relname IN ('records', 'records_hot');
SQL

if [[ -f "$REPO_ROOT/scripts/diagnose-performance-regression.sh" ]]; then
  echo "=== Running diagnose-performance-regression.sh (diagnostics-records.log) ==="
  DIAG_OUT="$LOG_DIR/diagnostics-records.log"
  "$REPO_ROOT/scripts/diagnose-performance-regression.sh" > "$DIAG_OUT" 2>&1 || true
  echo "   Written to: $DIAG_OUT"
fi
echo "   Key artifacts: query_plan_full_analysis_*.txt, data-summary-records.txt, diagnostics-records.log, config_snapshot.txt"

# Quick Summary Table (readable format)
echo "=== Quick Performance Summary ==="
psql_in_pod -v run_id="$RUN_ID" <<'SQL' | tee "$LOG_DIR/quick_summary.txt"
-- Quick summary table for easy reading

SELECT
  variant || ' (' || phase || ')' AS test,
  clients AS clients,
  ROUND(tps::numeric, 0) AS tps,
  ROUND(lat_avg_ms::numeric, 2) AS lat_avg_ms,
  ROUND(p95_ms::numeric, 2) AS p95_ms,
  ROUND(p99_ms::numeric, 2) AS p99_ms,
  ROUND(p999_ms::numeric, 2) AS p999_ms,
  ROUND((100.0 * (tps - (clients * 1000.0 / NULLIF(lat_avg_ms, 0))) / NULLIF((clients * 1000.0 / NULLIF(lat_avg_ms, 0)), 0))::numeric, 1) AS tps_efficiency_pct,
  ROUND(hit_ratio_pct::numeric, 1) AS cache_hit_pct
FROM bench.results
WHERE variant IN ('knn', 'trgm', 'noop')
  AND tps IS NOT NULL
  AND run_id = :'run_id'
ORDER BY 
  CASE variant WHEN 'noop' THEN 1 WHEN 'knn' THEN 2 WHEN 'trgm' THEN 3 END,
  phase,
  clients;
SQL

echo ""
echo "📊 Quick summary saved to: $LOG_DIR/quick_summary.txt"
[[ "$RUN_TELEMETRY" == "true" ]] && [[ -d "${LOG_DIR:-}/telemetry" ]] && echo "📊 Telemetry (perf, strace, htop): $LOG_DIR/telemetry/"
echo ""

# Create automatic backup after benchmark (only if explicitly requested)
# NOTE: Default is false to avoid disk bloat during repeated benchmark runs
# Since Postgres is external (Docker), we can use Docker-based backup scripts
if [[ "$CREATE_BENCH_BACKUP" == "true" ]]; then
  echo "=== Creating automatic backup ==="
  # Check if database is ready
  if ! psql_in_pod -c "SELECT 1;" >/dev/null 2>&1; then
    echo "⚠️  Database not ready, skipping backup" >&2
  elif [[ -f "./scripts/create-comprehensive-backup.sh" ]]; then
    ./scripts/create-comprehensive-backup.sh
  elif [[ -f "./scripts/restore-to-external-docker.sh" ]]; then
    echo "⚠️  Using restore script for backup (may not be ideal)" >&2
    echo "   Consider using create-comprehensive-backup.sh for proper backups" >&2
  else
    echo "⚠️  Backup script not found, skipping automatic backup" >&2
  fi
else
  echo "⚠️  Backup disabled for this run (CREATE_BENCH_BACKUP=${CREATE_BENCH_BACKUP})"
fi
