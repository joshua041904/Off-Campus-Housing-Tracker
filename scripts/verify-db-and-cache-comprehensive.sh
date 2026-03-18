#!/usr/bin/env bash
# Comprehensive Database and Cache Verification
# Verifies DB operations, cache hits/misses, and service health.
# Optional: DB_VERIFY_MAX_SECONDS=60 to cap total runtime (uses timeout); PGCONNECT_TIMEOUT / DB_VERIFY_CONNECT_TIMEOUT for psql connect.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# Cap total runtime when run from run-all-test-suites (DB_VERIFY_MAX_SECONDS=60)
if [[ -n "${DB_VERIFY_MAX_SECONDS:-}" ]] && [[ "${DB_VERIFY_MAX_SECONDS}" -gt 0 ]] && command -v timeout >/dev/null 2>&1 && [[ "${DB_VERIFY_COMPREHENSIVE_UNDER_TIMEOUT:-0}" != "1" ]]; then
  export DB_VERIFY_COMPREHENSIVE_UNDER_TIMEOUT=1
  exec timeout "$DB_VERIFY_MAX_SECONDS" "$0" "$@"
fi

export PGCONNECT_TIMEOUT="${DB_VERIFY_CONNECT_TIMEOUT:-${PGCONNECT_TIMEOUT:-3}}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_FILE="${RESULTS_FILE:-/tmp/db-cache-verification-${TIMESTAMP}.log}"

# Redirect all output to results file AND stdout
exec > >(tee "$RESULTS_FILE")
exec 2>&1

say "=== Comprehensive Database and Cache Verification ==="
info "Results will be saved to: $RESULTS_FILE"
[[ -n "${DB_VERIFY_MAX_SECONDS:-}" ]] && [[ "${DB_VERIFY_MAX_SECONDS}" -gt 0 ]] && info "Max wall time: ${DB_VERIFY_MAX_SECONDS}s (DB_VERIFY_MAX_SECONDS)"

# Database ports (all 8 service DBs: 5433–5440)
AUTH_DB_PORT=5437
RECORDS_DB_PORT=5433
SOCIAL_DB_PORT=5434
LISTINGS_DB_PORT=5435
SHOPPING_DB_PORT=5436
AUCTION_MONITOR_DB_PORT=5438
ANALYTICS_DB_PORT=5439
PYTHON_AI_DB_PORT=5440

# Test database connectivity (use per-port DB: postgres default for 5438/5440; records/analytics for others)
test_db_connectivity() {
  say "Testing Database Connectivity..."
  local ports="$RECORDS_DB_PORT $SOCIAL_DB_PORT $LISTINGS_DB_PORT $SHOPPING_DB_PORT $AUTH_DB_PORT $AUCTION_MONITOR_DB_PORT $ANALYTICS_DB_PORT $PYTHON_AI_DB_PORT"
  for port in $ports; do
    local db="records"
    [[ "$port" -eq 5438 ]] && db="postgres"
    [[ "$port" -eq 5440 ]] && db="postgres"
    [[ "$port" -eq 5439 ]] && db="analytics"
    if PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p "$port" -U postgres -d "$db" -c "SELECT 1;" >/dev/null 2>&1; then
      ok "Database port $port: Connected"
    elif PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p "$port" -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
      ok "Database port $port: Connected (postgres)"
    else
      warn "Database port $port: Connection failed"
    fi
  done
}

# Verify shopping cart operations
verify_shopping_cart() {
  say "Verifying Shopping Cart Operations..."
  
  if [[ -z "${USER1_ID:-}" ]]; then
    warn "USER1_ID not set - skipping cart verification"
    return
  fi
  
  # Check cart items
  CART_COUNT=$(PGPASSWORD=postgres psql -h localhost -p $SHOPPING_DB_PORT -U postgres -d records -tAc \
    "SELECT COUNT(*) FROM shopping.shopping_cart WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
  
  # Check orders (items removed from cart during checkout)
  ORDER_COUNT=$(PGPASSWORD=postgres psql -h localhost -p $SHOPPING_DB_PORT -U postgres -d records -tAc \
    "SELECT COUNT(*) FROM shopping.orders WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
  
  if [[ "$CART_COUNT" -gt 0 ]]; then
    ok "Shopping cart: $CART_COUNT items in cart"
  elif [[ "$ORDER_COUNT" -gt 0 ]]; then
    ok "Shopping cart: Empty (expected - $ORDER_COUNT order(s) created, items removed during checkout)"
  else
    info "Shopping cart: Empty (no items added or all removed)"
  fi
  
  # Verify purchase history
  PURCHASE_COUNT=$(PGPASSWORD=postgres psql -h localhost -p $SHOPPING_DB_PORT -U postgres -d records -tAc \
    "SELECT COUNT(*) FROM shopping.purchase_history WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
  
  if [[ "$PURCHASE_COUNT" -gt 0 ]]; then
    ok "Purchase history: $PURCHASE_COUNT purchase(s) recorded"
  fi
}

# Verify cache operations (check Redis if available)
verify_cache_operations() {
  say "Verifying Cache Operations..."
  
  # Check if Redis is available (externalized, may not be in cluster)
  REDIS_POD=$(kubectl -n record-platform get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -n "$REDIS_POD" ]]; then
    ok "Redis pod found: $REDIS_POD"
    
    # Check Redis connectivity
    if kubectl -n record-platform exec "$REDIS_POD" -- redis-cli ping >/dev/null 2>&1; then
      ok "Redis: Connected and responding"
      
      # Get cache stats
      REDIS_INFO=$(kubectl -n record-platform exec "$REDIS_POD" -- redis-cli info stats 2>/dev/null || echo "")
      if [[ -n "$REDIS_INFO" ]]; then
        KEYS_HIT=$(echo "$REDIS_INFO" | grep "keyspace_hits" | cut -d: -f2 | tr -d '\r' || echo "0")
        KEYS_MISS=$(echo "$REDIS_INFO" | grep "keyspace_misses" | cut -d: -f2 | tr -d '\r' || echo "0")
        
        if [[ "$KEYS_HIT" =~ ^[0-9]+$ ]] && [[ "$KEYS_MISS" =~ ^[0-9]+$ ]]; then
          TOTAL=$((KEYS_HIT + KEYS_MISS))
          if [[ "$TOTAL" -gt 0 ]]; then
            HIT_RATE=$(echo "scale=2; $KEYS_HIT * 100 / $TOTAL" | bc -l 2>/dev/null || echo "0")
            ok "Cache hit rate: ${HIT_RATE}% (${KEYS_HIT} hits, ${KEYS_MISS} misses)"
          else
            info "Cache: No operations recorded yet"
          fi
        fi
      fi
    else
      warn "Redis: Not responding"
    fi
  else
    info "Redis: Externalized (not in cluster) - cache verification skipped"
  fi
  
  # Check service-level cache behavior (via health endpoints)
  say "Checking Service Cache Behavior..."
  
  # Test auth service cache (multiple requests should show cache hits)
  if command -v curl >/dev/null 2>&1; then
    HOST="${HOST:-record.local}"
    PORT="${PORT:-30443}"
    
    # Make multiple requests to same endpoint (should hit cache on subsequent requests)
    for i in {1..3}; do
      START_TIME=$(date +%s%N)
      RESPONSE=$(curl -k -s --http2 --max-time 5 \
        --resolve "${HOST}:${PORT}:127.0.0.1" \
        -H "Host: $HOST" \
        "https://${HOST}:${PORT}/api/auth/healthz" 2>/dev/null || echo "ERROR")
      END_TIME=$(date +%s%N)
      DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
      
      if [[ "$RESPONSE" != "ERROR" ]]; then
        if [[ $i -eq 1 ]]; then
          info "  Request $i: ${DURATION}ms (cold start)"
        else
          info "  Request $i: ${DURATION}ms (should be faster if cached)"
        fi
      fi
    done
  fi
}

# Verify social service health and operations
verify_social_service() {
  say "Verifying Social Service Operations..."
  SOCIAL_DB_PORT="${SOCIAL_DB_PORT:-5434}"
  
  # Check social service pod health
  SOCIAL_PODS=($(kubectl -n record-platform get pods -l app=social-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))
  
  if [[ ${#SOCIAL_PODS[@]} -eq 0 ]]; then
    warn "Social service: No pods found"
    return
  fi
  
  ok "Social service: ${#SOCIAL_PODS[@]} pod(s) found"
  
  # Check pod status
  for pod in "${SOCIAL_PODS[@]}"; do
    STATUS=$(kubectl -n record-platform get pod "$pod" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    READY=$(kubectl -n record-platform get pod "$pod" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    
    if [[ "$STATUS" == "Running" ]] && [[ "$READY" == "true" ]]; then
      ok "  Pod $pod: Running and Ready"
    else
      warn "  Pod $pod: Status=$STATUS, Ready=$READY"
    fi
  done
  
  # Check database connectivity: social pod typically has no psql; try host first, then Node in pod
  if [[ ${#SOCIAL_PODS[@]} -gt 0 ]]; then
    SOCIAL_POD="${SOCIAL_PODS[0]}"
    DB_CHECK=""
    # 1) Host psql (Docker Compose postgres-social on 5434) - most reliable when available
    if command -v psql >/dev/null 2>&1; then
      HOST_CHECK=$(PGPASSWORD=postgres psql -h localhost -p "$SOCIAL_DB_PORT" -U postgres -d records -tAc "SELECT 1;" 2>/dev/null || echo "")
      [[ -z "$HOST_CHECK" ]] && HOST_CHECK=$(PGPASSWORD=postgres psql -h localhost -p "$SOCIAL_DB_PORT" -U postgres -d postgres -tAc "SELECT 1;" 2>/dev/null || echo "")
      [[ "$HOST_CHECK" == "1" ]] && DB_CHECK="OK"
    fi
    # 2) Pod: Node + pg (social-service has these; psql usually not)
    if [[ "$DB_CHECK" != "OK" ]]; then
      NODE_CHECK=$(kubectl -n record-platform exec "$SOCIAL_POD" -- node -e "
        const u=process.env.POSTGRES_URL_SOCIAL||process.env.DATABASE_URL;
        if(!u){process.exit(1);}
        require('pg').Client({connectionString:u,connectionTimeoutMillis:3000}).connect().then(()=>{console.log('OK');process.exit(0);}).catch(()=>process.exit(1));
      " 2>/dev/null || echo "")
      [[ "$NODE_CHECK" == "OK" ]] && DB_CHECK="OK"
    fi
    # 3) Pod: psql if present (e.g. debug image)
    if [[ "$DB_CHECK" != "OK" ]]; then
      PSQL_CHECK=$(kubectl -n record-platform exec "$SOCIAL_POD" -- sh -c 'echo "SELECT 1;" | timeout 5 psql "${POSTGRES_URL_SOCIAL:-$DATABASE_URL}" -tAc "SELECT 1" 2>/dev/null' 2>/dev/null || echo "")
      [[ "$PSQL_CHECK" == "1" ]] && DB_CHECK="OK"
    fi
    if [[ "$DB_CHECK" == "OK" ]]; then
      ok "Social service DB connectivity: OK"
    else
      warn "Social service DB connectivity: FAILED (check Docker Compose postgres-social on port $SOCIAL_DB_PORT or cluster DB)"
    fi
  fi
  
  # Check social service database tables
  if [[ -n "${USER1_ID:-}" ]]; then
    # Check forum posts
    POST_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "$SOCIAL_DB_PORT" -U postgres -d records -tAc \
      "SELECT COUNT(*) FROM forum.posts WHERE user_id='${USER1_ID}';" 2>/dev/null || echo "0")
    
    if [[ "$POST_COUNT" -gt 0 ]]; then
      ok "Forum posts: $POST_COUNT post(s) created by user"
    fi
    
    # Check messages
    MESSAGE_COUNT=$(PGPASSWORD=postgres psql -h localhost -p "$SOCIAL_DB_PORT" -U postgres -d records -tAc \
      "SELECT COUNT(*) FROM messages.messages WHERE sender_id='${USER1_ID}';" 2>/dev/null || echo "0")
    
    if [[ "$MESSAGE_COUNT" -gt 0 ]]; then
      ok "Messages: $MESSAGE_COUNT message(s) sent by user"
    fi
  fi
  
  # Test social service health endpoint
  if command -v curl >/dev/null 2>&1; then
    HOST="${HOST:-record.local}"
    PORT="${PORT:-30443}"
    
    SOCIAL_HEALTH=$(curl -k -s --http2 --max-time 5 \
      --resolve "${HOST}:${PORT}:127.0.0.1" \
      -H "Host: $HOST" \
      "https://${HOST}:${PORT}/api/social/healthz" 2>/dev/null || echo "ERROR")
    
    if echo "$SOCIAL_HEALTH" | grep -qiE "(ok|healthy|200)"; then
      ok "Social service health endpoint: OK"
    elif echo "$SOCIAL_HEALTH" | grep -qiE "502|upstream error"; then
      warn "Social service health endpoint: 502 upstream error (service may be down or unreachable)"
    else
      warn "Social service health endpoint: Unexpected response: ${SOCIAL_HEALTH:0:50}"
    fi
  fi
}

# Verify HTTP/3 packet capture
verify_http3_capture() {
  say "Verifying HTTP/3 Packet Capture..."
  
  CADDY_POD=$(kubectl -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -z "$CADDY_POD" ]]; then
    warn "Caddy pod not found - cannot verify HTTP/3 capture"
    return
  fi
  
  ok "Caddy pod found: $CADDY_POD"
  
  # Check if tcpdump is available
  if kubectl -n ingress-nginx exec "$CADDY_POD" -- which tcpdump >/dev/null 2>&1; then
    ok "tcpdump: Available in Caddy pod"
  else
    warn "tcpdump: Not available in Caddy pod"
  fi
  
  # Check for recent HTTP/3 captures (tests write to /tmp/smoke-test-captures-*, baseline-captures-*, rotation-wire-*)
  CAPTURE_FILES=$(find /tmp -maxdepth 4 \( -name "*http3*.pcap" -o -name "*quic*.pcap" -o -name "caddy-*-caddy-*.pcap" \) 2>/dev/null | head -10 || echo "")
  
  if [[ -n "$CAPTURE_FILES" ]]; then
    ok "HTTP/3 capture files found:"
    echo "$CAPTURE_FILES" | while read -r file; do
      if [[ -f "$file" ]]; then
        SIZE=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
        info "  - $file (${SIZE} bytes)"
      fi
    done
  else
    info "No HTTP/3 capture files found in /tmp (may need to run tests with packet capture)"
  fi
  
  # Check if tshark can analyze QUIC
  if command -v tshark >/dev/null 2>&1; then
    ok "tshark: Available for protocol analysis"
  else
    warn "tshark: Not available (install for protocol verification)"
  fi
}

# Main execution
main() {
  test_db_connectivity
  verify_shopping_cart
  verify_cache_operations
  verify_social_service
  verify_http3_capture
  
  say "=== Verification Complete ==="
  ok "Full results saved to: $RESULTS_FILE"
  info "To view results: cat $RESULTS_FILE"
}

main "$@"
