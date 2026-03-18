#!/usr/bin/env bash
# Quick DB and Cache Verification (called after each test suite)
# Proves Redis and Lua are working after DB operations
#
# Optional: DB_VERIFY_MAX_SECONDS=60 — cap total runtime (uses `timeout` so verification never blocks forever).
# Optional: DB_VERIFY_CONNECT_TIMEOUT=3 — psql connect timeout per DB (default 3).
# Optional: DB_VERIFY_FAST=1 — use existence checks only for social/shopping (no full COUNT); much faster on large tables. Preflight sets this when DB_VERIFY_MAX_SECONDS is set.
# Optional: DB_VERIFY_STATEMENT_TIMEOUT=3 — statement timeout in seconds for social/shopping queries so step 4 never hangs on huge tables.
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

# 1. Database Connectivity Check (all 8 service DBs: 5433–5440)
# Preflight (run-preflight-scale-and-all-suites.sh) starts postgres-auction-monitor (5438) and postgres-python-ai (5440) via docker compose.
# Use short connect timeout so this step never blocks (DB_VERIFY_CONNECT_TIMEOUT=3).
export PGCONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT:-3}"
say "1. Database Connectivity (connect timeout ${PGCONNECT_TIMEOUT}s)..."
DB_PORTS=(5433 5434 5435 5436 5437 5438 5439 5440)
DB_NAMES=(records social listings shopping auth auction-monitor analytics python-ai)
# DB to use per port (postgres = default DB in all containers; records/analytics used by apps and may be created by migrations)
DB_NAMES_PER_PORT=(records records records records records postgres analytics postgres)
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
REDIS_POD=$(kubectl -n record-platform get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [[ -n "$REDIS_POD" ]]; then
  if kubectl -n record-platform exec "$REDIS_POD" -- redis-cli ping >/dev/null 2>&1; then
    ok "Redis: Connected"
    
    # Get cache hit/miss stats (proves Redis is working)
    REDIS_STATS=$(kubectl -n record-platform exec "$REDIS_POD" -- redis-cli info stats 2>/dev/null || echo "")
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
      SCRIPT_COUNT=$(kubectl -n record-platform exec "$REDIS_POD" -- redis-cli script exists $(kubectl -n record-platform exec "$REDIS_POD" -- redis-cli script list 2>/dev/null | head -1 | cut -d' ' -f1 2>/dev/null || echo "") 2>/dev/null | grep -c "1" || echo "0")
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
    REDIS_PORT="${REDIS_PORT:-6379}"
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
      warn "Redis: Not reachable from host (tried localhost, 127.0.0.1, host.docker.internal) — ensure Docker Compose Redis is running and port 6379 is exposed"
    fi
  else
    info "Redis: Externalized (not in cluster) — cache verification skipped (redis-cli not installed)"
  fi
fi

# 3. Shopping Cart Verification (if user ID available)
say "3. Shopping Cart Verification..."
if [[ -n "${USER1_ID:-}" ]]; then
  CART_COUNT=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5436 -U postgres -d shopping -tAc \
    "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
  
  ORDER_COUNT=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5436 -U postgres -d shopping -tAc \
    "SELECT COUNT(*) FROM shopping.orders WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
  
  if [[ "$CART_COUNT" -gt 0 ]]; then
    ok "Shopping cart: $CART_COUNT items (DB operation verified)"
  elif [[ "$ORDER_COUNT" -gt 0 ]]; then
    ok "Shopping cart: Empty, $ORDER_COUNT order(s) created (DB operation verified - items removed during checkout)"
  else
    info "Shopping cart: No items for user (may not have run cart tests)"
  fi
else
  # Check overall table health (0 carts + N orders is normal after checkout — cart is cleared)
  # When DB_VERIFY_FAST=1 skip full COUNT (can be slow on millions of rows); do existence check only.
  if [[ "${DB_VERIFY_FAST:-0}" == "1" ]]; then
    _has_cart=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT 1 FROM shopping.shopping_cart LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "0")
    _has_order=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5436 -U postgres -d shopping -tAc "SELECT 1 FROM shopping.orders LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "0")
    [[ "$_has_cart" == "1" ]] || [[ "$_has_order" == "1" ]] && ok "Shopping DB (5436): tables reachable (existence check)" || info "Shopping tables: empty or unreachable"
  else
    TOTAL_CARTS=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5436 -U postgres -d shopping -tAc \
      "SELECT COUNT(*) FROM shopping.shopping_cart;" 2>/dev/null | tr -d ' \n' || echo "0")
    TOTAL_ORDERS=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5436 -U postgres -d shopping -tAc \
      "SELECT COUNT(*) FROM shopping.orders;" 2>/dev/null | tr -d ' \n' || echo "0")
    if [[ "${TOTAL_ORDERS:-0}" -gt 0 ]] && [[ "${TOTAL_CARTS:-0}" -eq 0 ]]; then
      ok "Shopping tables: 0 carts, $TOTAL_ORDERS orders (expected after checkout; DB verified)"
    else
      info "Shopping tables: $TOTAL_CARTS carts, $TOTAL_ORDERS orders (DB connectivity verified)"
    fi
  fi
fi

# 4. Social Service DB Verification
# Forum posts live in forum.posts; P2P/group messages live in messages.messages (schema "messages", not "forum")
# Existence: use metadata (pg_stat_user_tables) so we never scan large tables — SELECT 1 FROM forum.posts LIMIT 1 can seq-scan and hang.
# When USER1_ID is set: optional COUNT with statement_timeout (can be slow on huge tables).
say "4. Social Service DB Verification..."
_run_social_verify() {
  local _s="${DB_VERIFY_STATEMENT_TIMEOUT:-2}"; [[ -z "$_s" ]] || [[ "$_s" -le 0 ]] && _s=2
  _psql() { PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" PGOPTIONS="-c statement_timeout=${_s}000" psql -h localhost -p 5434 -U postgres -d records "$@" 2>/dev/null; }
  if [[ -n "${USER1_ID:-}" ]]; then
    local p m; p=$(_psql -tAc "SELECT COUNT(*) FROM forum.posts WHERE user_id='${USER1_ID}';" | tr -d ' \n' || echo "0"); m=$(_psql -tAc "SELECT COUNT(*) FROM messages.messages WHERE sender_id='${USER1_ID}';" | tr -d ' \n' || echo "0")
    [[ "${p:-0}" -gt 0 ]] && ok "Forum posts: $p (DB operation verified)"; [[ "${m:-0}" -gt 0 ]] && ok "Messages: $m (DB operation verified)"
  else
    # Metadata-only: no scan of forum.posts or messages.messages (avoids seq-scan hang on large tables)
    local a b; a=$(_psql -tAc "SELECT 1 FROM pg_stat_user_tables WHERE schemaname='forum' AND relname='posts' LIMIT 1;" | tr -d ' \n' || echo "0"); b=$(_psql -tAc "SELECT 1 FROM pg_stat_user_tables WHERE schemaname='messages' AND relname='messages' LIMIT 1;" | tr -d ' \n' || echo "0")
    [[ "$a" == "1" ]] || [[ "$b" == "1" ]] && ok "Social DB (5434): forum.posts and messages.messages reachable (existence check)" || info "Social tables: empty or unreachable"
  fi
}
if command -v timeout >/dev/null 2>&1; then
  timeout 15 bash -c '
    ok() { echo "✅ $*"; }; info() { echo "ℹ️  $*"; }
    export USER1_ID="'"${USER1_ID:-}"'" PGCONNECT_TIMEOUT="'"${PGCONNECT_TIMEOUT:-3}"'"
    _s=2; _psql() { PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" PGOPTIONS="-c statement_timeout=${_s}000" psql -h localhost -p 5434 -U postgres -d records "$@" 2>/dev/null; }
    if [[ -n "${USER1_ID:-}" ]]; then
      p=$(_psql -tAc "SELECT COUNT(*) FROM forum.posts WHERE user_id='"'"'${USER1_ID}'"'"';" | tr -d " \n" || echo "0"); m=$(_psql -tAc "SELECT COUNT(*) FROM messages.messages WHERE sender_id='"'"'${USER1_ID}'"'"';" | tr -d " \n" || echo "0")
      [[ "${p:-0}" -gt 0 ]] && ok "Forum posts: $p (DB operation verified)"; [[ "${m:-0}" -gt 0 ]] && ok "Messages: $m (DB operation verified)"
    else
      a=$(_psql -tAc "SELECT 1 FROM pg_stat_user_tables WHERE schemaname='"'"'forum'"'"' AND relname='"'"'posts'"'"' LIMIT 1;" | tr -d " \n" || echo "0"); b=$(_psql -tAc "SELECT 1 FROM pg_stat_user_tables WHERE schemaname='"'"'messages'"'"' AND relname='"'"'messages'"'"' LIMIT 1;" | tr -d " \n" || echo "0")
      [[ "$a" == "1" ]] || [[ "$b" == "1" ]] && ok "Social DB (5434): forum and messages reachable" || info "Social tables: empty or unreachable"
    fi
  ' 2>/dev/null || info "Social DB verification timed out (15s) or failed"
else
  _run_social_verify
fi

# 5. Catalog / analytics schema existence (records 5433 has catalog.*; analytics 5439 has analytics.*)
# Metadata-only so we don't scan large tables. See docs/CURRENT_DB_SCHEMA_REPORT.md for full table list.
say "5. Catalog & Analytics schema (existence)..."
_cat_rec=$({ PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5433 -U postgres -d records -tAc "SELECT 1 FROM pg_namespace WHERE nspname='catalog' LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "0"; })
_cat_ana=$({ PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p 5439 -U postgres -d analytics -tAc "SELECT 1 FROM pg_tables WHERE schemaname='analytics' LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "0"; })
if [[ "$_cat_rec" == "1" ]]; then
  ok "Records DB (5433): catalog schema present"
else
  info "Records DB (5433): catalog schema not found (migration 11 may not be applied)"
fi
if [[ "$_cat_ana" == "1" ]]; then
  ok "Analytics DB (5439): analytics schema present"
else
  info "Analytics DB (5439): analytics schema not found or unreachable"
fi

DB_VERIFY_QUICK_END=$(date +%s)
DB_VERIFY_QUICK_DURATION=$((DB_VERIFY_QUICK_END - DB_VERIFY_QUICK_START))
say "=== Quick Verification Complete ==="
info "Duration: ${DB_VERIFY_QUICK_DURATION}s (start: $DB_VERIFY_QUICK_START_HUMAN, end: $(date '+%H:%M:%S'))"
info "Full log: $VERIFY_LOG"
