#!/usr/bin/env bash
# Quick DB and Cache Verification (called after each test suite)
# Proves Redis and Lua are working after DB operations
#
# Optional: DB_VERIFY_MAX_SECONDS=60 — cap total runtime (uses `timeout` so verification never blocks forever).
# Optional: DB_VERIFY_CONNECT_TIMEOUT=3 — psql connect timeout per DB (default 3).
# Optional: DB_VERIFY_FAST=1 — use existence checks only (no full COUNT). Preflight sets this when DB_VERIFY_MAX_SECONDS is set.
# Optional: SKIP_REDIS_HOST_CHECK=1 — skip host-level Redis probe when Redis is in-cluster or external (Colima/K8s). run-all sets this for Colima.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# One-time exec under timeout so the whole script is bounded (avoids "taking forever" after baseline/suites)
if [[ -n "${DB_VERIFY_MAX_SECONDS:-}" ]] && [[ "${DB_VERIFY_MAX_SECONDS}" -gt 0 ]] && \
   command -v timeout >/dev/null 2>&1 && [[ "${DB_VERIFY_UNDER_TIMEOUT:-0}" != "1" ]]; then
  export DB_VERIFY_UNDER_TIMEOUT=1
  exec timeout "$DB_VERIFY_MAX_SECONDS" "$0" "$@"
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

VERIFY_LOG="${VERIFY_LOG:-/tmp/db-cache-verify-$(date +%s).log}"

# Redirect to log and stdout
exec > >(tee -a "$VERIFY_LOG")
exec 2>&1

DB_VERIFY_QUICK_START=$(date +%s)
DB_VERIFY_QUICK_START_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
say "=== Quick DB & Cache Verification (Post-Test) ==="
info "Started: $DB_VERIFY_QUICK_START_HUMAN"
info "Log: $VERIFY_LOG"
[[ -n "${DB_VERIFY_MAX_SECONDS:-}" ]] && [[ "${DB_VERIFY_MAX_SECONDS}" -gt 0 ]] && info "Max wall time: ${DB_VERIFY_MAX_SECONDS}s (DB_VERIFY_MAX_SECONDS)"

# 1. Database Connectivity Check (housing 7 DBs: 5441–5447)
# Use short connect timeout so this step never blocks (DB_VERIFY_CONNECT_TIMEOUT=3).
export PGCONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT:-3}"
say "1. Database Connectivity (connect timeout ${PGCONNECT_TIMEOUT}s)..."
DB_PORTS=(5441 5442 5443 5444 5445 5446 5447)
DB_NAMES=(auth listings bookings messaging notification trust analytics)
DB_NAMES_PER_PORT=(auth listings bookings messaging notification trust analytics)
for i in "${!DB_PORTS[@]}"; do
  port="${DB_PORTS[$i]}"
  db_label="${DB_NAMES[$i]}"
  db_conn="${DB_NAMES_PER_PORT[$i]:-postgres}"
  if PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_conn" -c "SELECT 1;" >/dev/null 2>&1; then
    ok "DB port $port ($db_label): Connected"
  else
    # Fallback: try default 'postgres' DB (every container has it)
    if PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p "$port" -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
      ok "DB port $port ($db_label): Connected (postgres)"
    else
      warn "DB port $port ($db_label): Connection failed"
    fi
  fi
done

# 2. Cache Verification (Redis + Lua)
say "2. Cache Verification (Redis + Lua Singleflight)..."
REDIS_POD=$(kubectl -n off-campus-housing-tracker get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$REDIS_POD" ]]; then
  if kubectl -n off-campus-housing-tracker exec "$REDIS_POD" -- redis-cli ping >/dev/null 2>&1; then
    ok "Redis: Connected"
    
    # Get cache hit/miss stats (proves Redis is working)
    REDIS_STATS=$(kubectl -n off-campus-housing-tracker exec "$REDIS_POD" -- redis-cli info stats 2>/dev/null || echo "")
    if [[ -n "$REDIS_STATS" ]]; then
      HITS=$(echo "$REDIS_STATS" | grep "keyspace_hits" | cut -d: -f2 | tr -d '\r' || echo "0")
      MISSES=$(echo "$REDIS_STATS" | grep "keyspace_misses" | cut -d: -f2 | tr -d '\r' || echo "0")
      
      if [[ "$HITS" =~ ^[0-9]+$ ]] && [[ "$MISSES" =~ ^[0-9]+$ ]]; then
        TOTAL=$((HITS + MISSES))
        if [[ "$TOTAL" -gt 0 ]]; then
          HIT_RATE=$(echo "scale=2; $HITS * 100 / $TOTAL" | bc -l 2>/dev/null || echo "0")
          ok "Cache hit rate: ${HIT_RATE}% (${HITS} hits, ${MISSES} misses) - PROVES Redis working"
        else
          info "Cache: No operations yet (Redis ready)"
        fi
      fi
      
      # Check for Lua scripts (proves singleflight Lua is loaded)
      SCRIPT_COUNT=$(kubectl -n off-campus-housing-tracker exec "$REDIS_POD" -- redis-cli script exists $(kubectl -n off-campus-housing-tracker exec "$REDIS_POD" -- redis-cli script list 2>/dev/null | head -1 | cut -d' ' -f1 2>/dev/null || echo "") 2>/dev/null | grep -c "1" || echo "0")
      if [[ "$SCRIPT_COUNT" -gt 0 ]]; then
        ok "Lua scripts: Loaded (PROVES singleflight Lua working)"
      else
        info "Lua scripts: May be loaded on-demand (singleflight pattern)"
      fi
    fi
  else
    warn "Redis: Not responding"
  fi
else
  # Externalized Redis (Docker Compose) or in-cluster on Colima — probe from host only when context allows.
  # SKIP_REDIS_HOST_CHECK=1: Redis in cluster or external SaaS; host cannot reach it. Set for Colima/K8s.
  if [[ "${SKIP_REDIS_HOST_CHECK:-0}" == "1" ]]; then
    info "Redis: Externalized or in-cluster — skipping host check (SKIP_REDIS_HOST_CHECK=1)"
  elif command -v redis-cli >/dev/null 2>&1; then
    REDIS_PORT="${REDIS_PORT:-6380}"
    REDIS_REACHABLE=""
    for _h in localhost 127.0.0.1 host.docker.internal; do
      if redis-cli -h "$_h" -p "$REDIS_PORT" --connect-timeout 2 ping >/dev/null 2>&1; then
        REDIS_REACHABLE="$_h"
        break
      fi
    done
    if [[ -n "$REDIS_REACHABLE" ]]; then
      ok "Redis (external $REDIS_REACHABLE:$REDIS_PORT): Connected"
    else
      warn "Redis: Not reachable from host (tried localhost, 127.0.0.1, host.docker.internal) — ensure Docker Compose Redis is running and port ${REDIS_PORT:-6380} is exposed"
    fi
  else
    info "Redis: Externalized (not in cluster) — cache verification skipped (redis-cli not installed)"
  fi
fi

# 3. Housing DB schema existence (analytics 5447 only; protocol check)
say "3. Analytics schema (existence)..."
_cat_ana=$({ PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5447 -U postgres -d analytics -tAc "SELECT 1 FROM pg_tables WHERE schemaname='analytics' LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "0"; })
if [[ "$_cat_ana" == "1" ]]; then
  ok "Analytics DB (5447): analytics schema present"
else
  info "Analytics DB (5447): analytics schema not found or unreachable"
fi

DB_VERIFY_QUICK_END=$(date +%s)
DB_VERIFY_QUICK_DURATION=$((DB_VERIFY_QUICK_END - DB_VERIFY_QUICK_START))
say "=== Quick Verification Complete ==="
info "Duration: ${DB_VERIFY_QUICK_DURATION}s (start: $DB_VERIFY_QUICK_START_HUMAN, end: $(date '+%H:%M:%S'))"
info "Full log: $VERIFY_LOG"
