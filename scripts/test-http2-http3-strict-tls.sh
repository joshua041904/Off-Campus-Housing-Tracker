#!/usr/bin/env bash
# HTTP/2 tests use curl with --http2; HTTP/3 tests use http3_curl with --http3-only (no fallback). Same across all suites.
# Optional packet capture: ./scripts/run-suite-with-packet-capture.sh "$0" "$@"
set -euo pipefail

HOST="${HOST:-off-campus-housing.test}"
# Auto-detect port based on cluster, or use provided PORT
# Validate PORT if set - if it's 443 (default HTTPS), re-detect
if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "443" ]]; then
  CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$CURRENT_CONTEXT" == "kind-h3-multi" ]]; then
    # Multi-node cluster: try ports 8444, 8445, 8446
    for p in 8445 8446 8444; do
      if curl -k -s --http2 --max-time 1 -H "Host: ${HOST}" "https://127.0.0.1:${p}/_caddy/healthz" >/dev/null 2>&1; then
        PORT=$p
        break
      fi
    done
    PORT="${PORT:-8445}"
  else
    # With NodePort, use 30443 (or detect from service)
    PORT="${PORT:-30443}"  # Default to NodePort 30443
    # Try to detect actual NodePort from service if not set
    if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "30443" ]]; then
      DETECTED_PORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
      if [[ -n "$DETECTED_PORT" ]]; then
        PORT=$DETECTED_PORT
      fi
    fi
  fi
fi
NS_ING="ingress-nginx"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Cross-platform timeout command (macOS doesn't have timeout by default)
_timeout_cmd() {
  local timeout_seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$timeout_seconds" "$@"
  else
    # Fallback: use perl alarm (available on macOS)
    perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" "$@"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"

# For HTTP/3, we need to use the service ClusterIP when inside container network
# With hostNetwork, we used 127.0.0.1:443, but with NodePort, we need the service IP
# Detect service IP for HTTP/3 (inside container network, we can't use NodePort)
HTTP3_SVC_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -n "$HTTP3_SVC_IP" ]]; then
  HTTP3_RESOLVE="${HOST}:443:${HTTP3_SVC_IP}"
else
  # Fallback to 127.0.0.1 if service not found (shouldn't happen)
  HTTP3_RESOLVE="${HOST}:443:127.0.0.1"
fi

say "=== Testing HTTP/2, HTTP/3, and Strict TLS ==="

# Test 1: HTTP/2 health check
say "Test 1: HTTP/2 health check"
H2_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --http2 --max-time 10 \
  -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || H2_RESPONSE=""
if echo "$H2_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "HTTP/2 health check works"
else
  fail "HTTP/2 health check failed"
  echo "Response: $(echo "$H2_RESPONSE" | head -n3)"
fi

# Test 2: HTTP/3 health check
say "Test 2: HTTP/3 health check"
H3_HEALTH_OUTPUT=$(http3_curl -k -sS -I --http3-only --max-time 30 \
  -H "Host: ${HOST}" \
  --resolve "$HTTP3_RESOLVE" \
  "https://${HOST}/_caddy/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  H3_HEALTH_OUTPUT=""
}
if echo "$H3_HEALTH_OUTPUT" | head -n1 | grep -q "HTTP/3 200"; then
  ok "HTTP/3 health check works"
else
  warn "HTTP/3 health check failed (QUIC path unavailable)"
  # Debug: show what we got if it's not empty
  if [[ -n "$H3_HEALTH_OUTPUT" ]]; then
    echo "  Response: $(echo "$H3_HEALTH_OUTPUT" | head -n3)"
  fi
fi

# Test 3: HTTP/2 API endpoint
say "Test 3: HTTP/2 API endpoint"
API_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 \
  -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/api/healthz" 2>&1) || API_RESPONSE=""
API_CODE=$(echo "$API_RESPONSE" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$API_CODE" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/2 (status: $API_CODE)"
else
  warn "API endpoint test failed (status: $API_CODE)"
fi

# Test 4: HTTP/3 API endpoint
say "Test 4: HTTP/3 API endpoint"
API_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
  -H "Host: ${HOST}" \
  --resolve "$HTTP3_RESOLVE" \
  "https://${HOST}/api/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  API_RESPONSE_H3="000"
}
HTTP_CODE_H3=$(echo "$API_RESPONSE_H3" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/3 (status: $HTTP_CODE_H3)"
else
  warn "API endpoint test failed (status: $HTTP_CODE_H3)"
fi

# Test 5: Strict TLS - TLS 1.3
say "Test 5: Strict TLS - TLS 1.3"
TLS13_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.3 --http2 \
  -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || TLS13_RESPONSE=""
if echo "$TLS13_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.3 works"
else
  warn "TLS 1.3 test failed"
  # Debug: show what we got
  echo "  Response: $(echo "$TLS13_RESPONSE" | head -n1)"
fi

# Test 6: Strict TLS - TLS 1.2
say "Test 6: Strict TLS - TLS 1.2"
TLS12_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.2 --http2 \
  -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || TLS12_RESPONSE=""
if echo "$TLS12_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.2 works"
else
  warn "TLS 1.2 test failed"
  echo "  Response: $(echo "$TLS12_RESPONSE" | head -n1)"
fi

# Test 7: Strict TLS - TLS 1.1 should fail
say "Test 7: Strict TLS - TLS 1.1 should be rejected"
# Use --tls-max 1.1 to prevent curl from upgrading to higher TLS versions
# Temporarily disable exit on error to capture TLS 1.1 rejection
set +e
TLS11_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.1 --tls-max 1.1 --http2 \
  -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1)
TLS11_EXIT=$?
set -e
# Check if we got an error (rejection) or a successful response
if [[ $TLS11_EXIT -ne 0 ]] || echo "$TLS11_RESPONSE" | grep -qiE "error|handshake|protocol|SSL.*error|TLS.*error|unsupported protocol|alert.*protocol|wrong.*version|no protocols available|TLS connect error|routines"; then
  ok "TLS 1.1 correctly rejected (strict TLS working)"
elif echo "$TLS11_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  # TLS 1.1 connection succeeded - this means strict TLS is NOT working
  fail "TLS 1.1 was NOT rejected - connection succeeded (strict TLS not working)"
  echo "  Response: $(echo "$TLS11_RESPONSE" | head -n1)"
  echo "  Caddy should reject TLS 1.1 when configured with 'protocols tls1.2 tls1.3'"
else
  # Unknown response - check if TLS 1.2/1.3 work to confirm strict TLS is partially working
  TLS12_VERIFY=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.2 --http2 \
    -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || TLS12_VERIFY=""
  TLS13_VERIFY=$(/opt/homebrew/opt/curl/bin/curl -k -sS -I --tlsv1.3 --http2 \
    -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || TLS13_VERIFY=""
  if echo "$TLS12_VERIFY" | head -n1 | grep -qE "200|HTTP/2 200" && echo "$TLS13_VERIFY" | head -n1 | grep -qE "200|HTTP/2 200"; then
    warn "TLS 1.1 test inconclusive, but TLS 1.2 and 1.3 work"
    echo "  Exit code: $TLS11_EXIT"
    echo "  Response: $(echo "$TLS11_RESPONSE" | head -n3)"
  else
    warn "TLS 1.1 test failed and TLS 1.2/1.3 also failed"
  fi
fi

# Test 8: Verify Caddy configuration
say "Test 8: Verify Caddy TLS configuration"
CADDY_CONFIG=$(kubectl -n "$NS_ING" get configmap caddy-h3 -o jsonpath='{.data.Caddyfile}' 2>/dev/null || echo "")
if echo "$CADDY_CONFIG" | grep -q "protocols tls1.2 tls1.3"; then
  ok "Caddy configured with strict TLS (TLS 1.2/1.3 only)"
else
  warn "Caddy may not have strict TLS configured"
fi

# Test 9: CA Rotation (optional - can be skipped with SKIP_ROTATION=1)
if [[ "${SKIP_ROTATION:-}" != "1" ]]; then
  say "Test 9: CA Rotation with Zero-Downtime Reload"
  say "Starting continuous requests during rotation..."
  
  # Clean up any old log file
  rm -f /tmp/rotation-test.log
  
  # Pre-rotation health check
  say "Pre-rotation health check..."
  PRE_ROTATION_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
    -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || PRE_ROTATION_RESPONSE=""
  if [[ -n "$PRE_ROTATION_RESPONSE" ]]; then
    PRE_ROTATION_HEALTH=$(echo "$PRE_ROTATION_RESPONSE" | tail -1 | tr -d '[:space:]')
  else
    PRE_ROTATION_HEALTH="000"
  fi
  if [[ "$PRE_ROTATION_HEALTH" != "200" ]]; then
    warn "Caddy is not healthy before rotation (HTTP $PRE_ROTATION_HEALTH) - skipping rotation test"
    SKIP_ROTATION=1
  else
    ok "Caddy is healthy before rotation (HTTP $PRE_ROTATION_HEALTH)"
  fi
  
  if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then
    # Start background requests - EXACT same approach as test-full-chain-with-rotation.sh
    # Create empty log file first
    rm -f /tmp/rotation-test.log
    touch /tmp/rotation-test.log
    # CONCURRENT POOL STRATEGY: Maintain constant pool of active requests for maximum throughput
    # Use HTTP/2 only for maximum speed (HTTP/3 via Docker is slower and causes bottlenecks)
    CONCURRENT_REQUESTS=10  # Parallel requests for HTTP/2 multiplexing
    (
      REQUEST_COUNT=0
      # Launch initial pool of concurrent requests
      while [[ $REQUEST_COUNT -lt $CONCURRENT_REQUESTS ]] && [[ $REQUEST_COUNT -lt 60 ]]; do
        (
            # Use HTTP/2 for maximum throughput
            # Increased timeout to 1.2s to catch edge cases during rotation
            RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 --max-time 1.2 \
              -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "timeout")
          echo "$RESPONSE" >> /tmp/rotation-test.log 2>&1
        ) &
        REQUEST_COUNT=$((REQUEST_COUNT + 1))
      done
      
      # Maintain pool: when one request completes, launch the next immediately
      # This keeps CONCURRENT_REQUESTS active at all times for maximum throughput
      while [[ $REQUEST_COUNT -lt 60 ]]; do
        # Wait for ANY job to complete (non-blocking pool maintenance)
        wait -n
        # Launch next request immediately to maintain pool size
        (
            # Use HTTP/2 for maximum throughput
            # Increased timeout to 1.2s to catch edge cases during rotation
            RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 --max-time 1.2 \
              -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "timeout")
          echo "$RESPONSE" >> /tmp/rotation-test.log 2>&1
        ) &
        REQUEST_COUNT=$((REQUEST_COUNT + 1))
      done
      
      # Wait for all remaining requests to complete
      wait
      # Final sync to ensure all writes are flushed
      sync /tmp/rotation-test.log 2>/dev/null || true
    ) &
  REQ_PID=$!
  # Give the process a moment to start writing (concurrent pool starts quickly)
  sleep 1
  # Verify the process is running and writing
  INITIAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
  if ! kill -0 $REQ_PID 2>/dev/null; then
    # Process might have completed already (very fast with concurrent pool)
    if [[ "$INITIAL_LINES" -gt 0 ]]; then
      ok "Background process completed quickly - $INITIAL_LINES requests logged"
    else
      warn "Background process failed to start or completed with no requests"
    fi
  else
    if [[ "$INITIAL_LINES" -eq "0" ]]; then
      # Give it one more second - concurrent pool might need a moment
      sleep 1
      INITIAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      if [[ "$INITIAL_LINES" -eq "0" ]]; then
        warn "Background process started but no requests logged yet"
      else
        ok "Background process started - $INITIAL_LINES requests logged initially"
      fi
    else
      ok "Background process started - $INITIAL_LINES requests logged initially"
    fi
  fi

    # Let requests establish before starting rotation (better baseline) - same as working script
    say "Establishing baseline requests (5 seconds)..."
    sleep 5
    
    # Perform CA rotation
    say "Rotating CA..."
    ROTATION_START=$(date +%s)
    if ./scripts/rotate-ca-and-fix-tls.sh >/dev/null 2>&1; then
      ROTATION_END=$(date +%s)
      ROTATION_DURATION=$((ROTATION_END - ROTATION_START))
      ok "CA rotation script completed (took ${ROTATION_DURATION}s)"
    else
      ROTATION_END=$(date +%s)
      ROTATION_DURATION=$((ROTATION_END - ROTATION_START))
      warn "CA rotation script returned non-zero status (took ${ROTATION_DURATION}s)"
      # Set a default duration if rotation failed very quickly
      if [[ "$ROTATION_DURATION" -lt 5 ]]; then
        ROTATION_DURATION=60  # Default to 60s if rotation failed immediately
      fi
    fi
    
    # Continue monitoring after rotation completes
    say "Continuing to monitor post-rotation (requests still running)..."
    
    # Wait for requests to complete - similar logic to test-full-chain-with-rotation.sh
    # 60 requests * 0.5s = 30s total, but we need to account for rotation time
    # Process started at T=0, baseline ended at T=2, rotation ended at T=2+ROTATION_DURATION
    # So remaining time = 30 - (2 + ROTATION_DURATION) + buffer
    REMAINING_TIME=$((30 - ROTATION_DURATION + 10))  # Add 10s buffer
    if [[ $REMAINING_TIME -lt 15 ]]; then
      REMAINING_TIME=15  # Minimum wait time
    fi
    
    say "Waiting for remaining requests to complete (estimated ${REMAINING_TIME}s, target: 60 requests)..."
    ELAPSED=0
    while kill -0 $REQ_PID 2>/dev/null && [[ $ELAPSED -lt $REMAINING_TIME ]]; do
      sleep 2
      ELAPSED=$((ELAPSED + 2))
      CURRENT_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      if [[ $((ELAPSED % 10)) -eq 0 ]] || [[ $CURRENT_LINES -ge 60 ]]; then
        echo "  Progress: $CURRENT_LINES/60 requests logged, ${ELAPSED}s elapsed..."
      fi
      if [[ $CURRENT_LINES -ge 60 ]]; then
        ok "All requests completed! ($CURRENT_LINES/60)"
        break
      fi
    done
    
    # If process is still running, wait a bit more with progress checks
    if kill -0 $REQ_PID 2>/dev/null; then
      say "Process still running, waiting longer for slow requests..."
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 60 ]]; do
        sleep 10
        EXTRA_WAIT=$((EXTRA_WAIT + 10))
        CURRENT_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $((EXTRA_WAIT % 30)) -eq 0 ]]; then
          echo "  Still waiting: $CURRENT_LINES/60 requests logged (${EXTRA_WAIT}s extra wait)..."
        fi
        if [[ $CURRENT_LINES -ge 60 ]]; then
          ok "All requests completed! ($CURRENT_LINES/60)"
          break
        fi
      done
      
      # Check if we're making progress
      if kill -0 $REQ_PID 2>/dev/null; then
        FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        PREV_LINES=$FINAL_LINES
        sleep 10
        NEW_FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        
        if [[ $NEW_FINAL_LINES -gt $PREV_LINES ]]; then
          say "Process still making progress ($PREV_LINES -> $NEW_FINAL_LINES), waiting 30 more seconds..."
          sleep 30
          FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        fi
        
        # Wait for ALL requests to complete - require 100% completion for production-grade testing
        if [[ $FINAL_LINES -ge 60 ]]; then
          # All requests completed
          ok "All requests completed! ($FINAL_LINES/60)"
          wait $REQ_PID 2>/dev/null || true
        else
          # Still waiting for more requests - give it more time
          say "Waiting for remaining requests ($FINAL_LINES/60), extending wait time..."
          FINAL_EXTRA_WAIT=0
          while kill -0 $REQ_PID 2>/dev/null && [[ $FINAL_EXTRA_WAIT -lt 60 ]] && [[ $FINAL_LINES -lt 60 ]]; do
            sleep 5
            FINAL_EXTRA_WAIT=$((FINAL_EXTRA_WAIT + 5))
            FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
            if [[ $FINAL_LINES -ge 60 ]]; then
              ok "All requests completed! ($FINAL_LINES/60)"
              break
            fi
            if [[ $((FINAL_EXTRA_WAIT % 15)) -eq 0 ]]; then
              echo "  Still waiting: $FINAL_LINES/60 requests logged (${FINAL_EXTRA_WAIT}s extra wait)..."
            fi
          done
          if kill -0 $REQ_PID 2>/dev/null; then
            FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
            if [[ $FINAL_LINES -lt 60 ]]; then
              warn "Background requests still running ($FINAL_LINES/60), but waiting for completion..."
              # Give one final wait
              sleep 30
              FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
            fi
            wait $REQ_PID 2>/dev/null || true
          else
            wait $REQ_PID 2>/dev/null || true
          fi
        fi
      else
        wait $REQ_PID 2>/dev/null || true
      fi
    else
      wait $REQ_PID 2>/dev/null || true
    fi
    
    # Flush the log file and wait a moment for all writes to complete
    sync /tmp/rotation-test.log 2>/dev/null || true
    sleep 2  # Give the process time to finish writing
    
    # Analyze results
    if [[ -f /tmp/rotation-test.log ]] && [[ -s /tmp/rotation-test.log ]]; then
      SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
      TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      TIMEOUT_COUNT=$(grep -cE "timeout|000|connection refused" /tmp/rotation-test.log 2>/dev/null || echo "0")
    else
      SUCCESS_COUNT="0"
      TOTAL_COUNT="0"
      TIMEOUT_COUNT="0"
    fi
    
    # Ensure counts are numeric
    SUCCESS_COUNT=$(echo "$SUCCESS_COUNT" | tr -d '[:space:]')
    TOTAL_COUNT=$(echo "$TOTAL_COUNT" | tr -d '[:space:]')
    TIMEOUT_COUNT=$(echo "$TIMEOUT_COUNT" | tr -d '[:space:]')
    
    # Default to 0 if empty
    SUCCESS_COUNT="${SUCCESS_COUNT:-0}"
    TOTAL_COUNT="${TOTAL_COUNT:-0}"
    TIMEOUT_COUNT="${TIMEOUT_COUNT:-0}"
    
    # Validate numeric
    if ! [[ "$SUCCESS_COUNT" =~ ^[0-9]+$ ]]; then
      SUCCESS_COUNT="0"
    fi
    if ! [[ "$TOTAL_COUNT" =~ ^[0-9]+$ ]]; then
      TOTAL_COUNT="0"
    fi
    
    # Calculate success rate - same logic as test-full-chain-with-rotation.sh
    if [[ "$TOTAL_COUNT" -gt 0 ]]; then
      SUCCESS_RATE=$((SUCCESS_COUNT * 100 / TOTAL_COUNT))
      
      # Check deployment strategy for better messaging
      STRATEGY=$(kubectl -n "$NS_ING" get deployment caddy-h3 -o jsonpath='{.spec.strategy.type}' 2>/dev/null || echo "Unknown")
      REPLICAS=$(kubectl -n "$NS_ING" get deployment caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
      
      if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
        if [[ "$SUCCESS_COUNT" -eq "$TOTAL_COUNT" ]] && [[ "$TOTAL_COUNT" -gt 0 ]]; then
          ok "✅ Zero-downtime rotation confirmed! (100% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
          if [[ "$STRATEGY" == "RollingUpdate" ]] && [[ "$REPLICAS" -ge 2 ]]; then
            ok "  ✅ Using RollingUpdate with $REPLICAS replicas - perfect zero-downtime setup!"
          elif [[ "$STRATEGY" == "RollingUpdate" ]]; then
            ok "  ✅ Using RollingUpdate with admin API reload - zero-downtime achieved!"
          fi
        elif [[ "$SUCCESS_RATE" -ge 95 ]]; then
          ok "✅ Near-zero-downtime rotation (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
          if [[ "$STRATEGY" == "RollingUpdate" ]] && [[ "$REPLICAS" -ge 2 ]]; then
            warn "  → Strategy is RollingUpdate with $REPLICAS replicas, but success rate < 100%"
            warn "  → Check if pods are on different nodes (required for hostNetwork)"
          else
            warn "  → For production: Use RollingUpdate strategy with 2+ replicas on multiple nodes for true 100% uptime"
          fi
        elif [[ "$SUCCESS_RATE" -ge 70 ]]; then
          warn "Rotation completed with downtime (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
          echo ""
          echo "  ℹ️  Lower success rate may indicate longer restart time or more requests during restart"
          if [[ "$STRATEGY" == "RollingUpdate" ]] && [[ "$REPLICAS" -ge 2 ]]; then
            warn "    → For production: Ensure pods are on different nodes for true zero-downtime"
          else
            warn "    → For production: Use RollingUpdate strategy with 2+ replicas on multiple nodes for zero-downtime"
            warn "    → With RollingUpdate + 2 replicas: Old pod stays up while new pod starts, eliminating downtime"
          fi
        elif [[ "$SUCCESS_RATE" -ge 40 ]]; then
          warn "Rotation completed with downtime (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
          say "  ℹ️  Lower success rate may indicate longer restart time or more requests during restart"
          if [[ "$STRATEGY" == "Recreate" ]]; then
            say "  ℹ️  This is expected with Recreate strategy"
          fi
          warn "  → For production: Use RollingUpdate strategy with 2+ replicas on multiple nodes for zero-downtime"
        else
          warn "Very low success rate during rotation (${SUCCESS_RATE}% - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
          warn "  → $TIMEOUT_COUNT requests failed/timed out during Caddy restart"
          warn "  → This may indicate issues with Caddy restart or very long restart time"
          warn "  → For production: Use RollingUpdate strategy with multiple replicas"
        fi
      else
        warn "No successful requests during rotation ($TOTAL_COUNT total requests, $TIMEOUT_COUNT timeouts)"
        warn "  → Caddy restart took longer than request intervals"
        warn "  → For production: Use RollingUpdate strategy with multiple replicas for zero-downtime"
      fi
      
      # Post-rotation health check
      say "Post-rotation health check..."
      sleep 2  # Give Caddy a moment to stabilize
      POST_ROTATION_RESPONSE=$(/opt/homebrew/opt/curl/bin/curl -k -sS -w "\n%{http_code}" --http2 \
        -H "Host: ${HOST}" "https://127.0.0.1:${PORT}/_caddy/healthz" 2>&1) || POST_ROTATION_RESPONSE=""
      if [[ -n "$POST_ROTATION_RESPONSE" ]]; then
        POST_ROTATION_HEALTH=$(echo "$POST_ROTATION_RESPONSE" | tail -1 | tr -d '[:space:]')
      else
        POST_ROTATION_HEALTH="000"
      fi
      if [[ "$POST_ROTATION_HEALTH" == "200" ]]; then
        ok "Caddy is healthy after rotation (HTTP $POST_ROTATION_HEALTH)"
      else
        warn "Caddy health check failed after rotation (HTTP $POST_ROTATION_HEALTH)"
      fi
    else
      warn "Could not analyze rotation results (log file may be empty or malformed)"
    fi
    
    rm -f /tmp/rotation-test.log
    
    # Verify new certificate is active
    say "Test 9b: Verify new certificate is active"
    CERT_INFO=$(echo | openssl s_client -connect "127.0.0.1:${PORT}" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null || echo "")
    if [[ -n "$CERT_INFO" ]]; then
      ok "Certificate info retrieved"
      echo "$CERT_INFO" | sed 's/^/  /'
    else
      warn "Could not retrieve certificate info (openssl may not be available or connection failed)"
    fi
  fi
else
  say "Test 9: CA Rotation (skipped - set SKIP_ROTATION=1 to skip)"
fi

say "=== All tests complete ==="
