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

# Database ports (housing 8 DBs: 5441–5448)
AUTH_DB_PORT=5441
LISTINGS_DB_PORT=5442
BOOKINGS_DB_PORT=5443
MESSAGING_DB_PORT=5444
NOTIFICATION_DB_PORT=5445
TRUST_DB_PORT=5446
ANALYTICS_DB_PORT=5447
MEDIA_DB_PORT=5448

# Test database connectivity (housing 8 DBs)
test_db_connectivity() {
  say "Testing Database Connectivity..."
  local ports="$AUTH_DB_PORT $LISTINGS_DB_PORT $BOOKINGS_DB_PORT $MESSAGING_DB_PORT $NOTIFICATION_DB_PORT $TRUST_DB_PORT $ANALYTICS_DB_PORT $MEDIA_DB_PORT"
  local db_names="auth listings bookings messaging notification trust analytics media"
  local i=0
  for port in $ports; do
    local db
    db=$(echo "$db_names" | awk -v i="$i" '{print $(i+1)}')
    i=$((i + 1))
    if PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p "$port" -U postgres -d "$db" -c "SELECT 1;" >/dev/null 2>&1; then
      ok "Database port $port ($db): Connected"
    elif PGPASSWORD=postgres PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}" psql -h localhost -p "$port" -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
      ok "Database port $port ($db): Connected (postgres)"
    else
      warn "Database port $port ($db): Connection failed"
    fi
  done
}

# Housing: no shopping cart; booking/listing checks can be added when schemas exist
verify_shopping_cart() {
  info "Housing stack: shopping cart verification skipped (use booking/listings checks when needed)"
}

# Verify cache operations (check Redis if available)
verify_cache_operations() {
  say "Verifying Cache Operations..."
  
  # Check if Redis is available (externalized, may not be in cluster)
  REDIS_POD=$(kubectl -n off-campus-housing-tracker get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -n "$REDIS_POD" ]]; then
    ok "Redis pod found: $REDIS_POD"
    
    # Check Redis connectivity
    if kubectl -n off-campus-housing-tracker exec "$REDIS_POD" -- redis-cli ping >/dev/null 2>&1; then
      ok "Redis: Connected and responding"
      
      # Get cache stats
      REDIS_INFO=$(kubectl -n off-campus-housing-tracker exec "$REDIS_POD" -- redis-cli info stats 2>/dev/null || echo "")
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
    HOST="${HOST:-off-campus-housing.test}"
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

# Verify messaging service health (housing: port 5444)
verify_social_service() {
  say "Verifying Messaging Service (DB port 5444)..."
  MESSAGING_PORT="${MESSAGING_DB_PORT:-5444}"
  MESSAGING_PODS=($(kubectl -n off-campus-housing-tracker get pods -l app=messaging-service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))
  if [[ ${#MESSAGING_PODS[@]} -eq 0 ]]; then
    info "Messaging service: No pods found (skip if not deployed)"
    if PGPASSWORD=postgres psql -h localhost -p "$MESSAGING_PORT" -U postgres -d messaging -tAc "SELECT 1;" 2>/dev/null | grep -q 1; then
      ok "Messaging DB (port $MESSAGING_PORT): Connected"
    fi
    return
  fi
  ok "Messaging service: ${#MESSAGING_PODS[@]} pod(s) found"
  if command -v psql >/dev/null 2>&1; then
    if PGPASSWORD=postgres psql -h localhost -p "$MESSAGING_PORT" -U postgres -d messaging -tAc "SELECT 1;" 2>/dev/null | grep -q 1; then
      ok "Messaging DB (port $MESSAGING_PORT): Connected"
    else
      warn "Messaging DB (port $MESSAGING_PORT): Connection failed"
    fi
  fi
  # Health endpoint (if exposed)
  if command -v curl >/dev/null 2>&1; then
    HOST="${HOST:-off-campus-housing.test}"
    PORT="${PORT:-30443}"
    MESSAGING_HEALTH=$(curl -k -s --http2 --max-time 5 \
      --resolve "${HOST}:${PORT}:127.0.0.1" \
      -H "Host: $HOST" \
      "https://${HOST}:${PORT}/api/messaging/healthz" 2>/dev/null || echo "ERROR")
    if echo "$MESSAGING_HEALTH" | grep -qiE "(ok|healthy|200)"; then
      ok "Messaging service health endpoint: OK"
    elif echo "$MESSAGING_HEALTH" | grep -qiE "502|upstream error"; then
      warn "Messaging service health endpoint: 502 upstream error (service may be down or unreachable)"
    else
      warn "Messaging service health endpoint: Unexpected response: ${MESSAGING_HEALTH:0:50}"
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
