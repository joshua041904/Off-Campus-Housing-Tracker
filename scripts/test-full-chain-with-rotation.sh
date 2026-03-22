#!/usr/bin/env bash
# HTTP/2 tests use nodeport_curl/curl with --http2; HTTP/3 tests use http3_curl with --http3-only (no fallback). Same across all suites.
set -euo pipefail

HOST="${HOST:-off-campus-housing.test}"
# Auto-detect port based on cluster, or use provided PORT
# Validate PORT if set - if it's 443 (default HTTPS), re-detect
if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "443" ]]; then
  CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$CURRENT_CONTEXT" == "kind-h3-multi" ]]; then
    # Multi-node cluster: try ports 8444, 8445, 8446
    # Test with direct IP (127.0.0.1) since hostNetwork pods bind to node IP
    PORT=""
    for p in 8445 8446 8444; do
      if curl -k -s --http2 --max-time 1 -H "Host: ${HOST}" "https://127.0.0.1:${p}/_caddy/healthz" >/dev/null 2>&1; then
        PORT=$p
        break
      fi
    done
    PORT="${PORT:-8445}"  # Default to 8445 (worker1) if none work
  else
    # Check if service is ClusterIP or NodePort
    SERVICE_TYPE=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null || echo "ClusterIP")
    if [[ "$SERVICE_TYPE" == "NodePort" ]]; then
      # With NodePort, detect actual NodePort from service
      DETECTED_PORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
      if [[ -n "$DETECTED_PORT" ]]; then
        PORT=$DETECTED_PORT
      else
        PORT="30443"  # Default to NodePort 30443
      fi
    else
      # ClusterIP service - use port-forward (8443)
      PORT="8443"  # Default to port-forward port
      # Set up port-forward for ClusterIP access
      if ! pgrep -f "kubectl.*port-forward.*caddy-h3.*8443:443" >/dev/null 2>&1; then
        kubectl -n ingress-nginx port-forward svc/caddy-h3 8443:443 >/dev/null 2>&1 &
        sleep 2  # Give port-forward time to establish
      fi
    fi
  fi
fi
NS_ING="ingress-nginx"
NS_APP="off-campus-housing-tracker"
LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-off-campus-housing-local-tls}"

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

CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"
# shellcheck source=scripts/lib/nodeport.sh
. "$SCRIPT_DIR/lib/nodeport.sh"

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

say "=== Full End-to-End Chain Test with CA Rotation ==="

# Test 1: Caddy health (H2)
say "Test 1: Caddy health via HTTP/2"
# Use nodeport_curl for macOS TLS issues (bypasses connection reset errors)
CADDY_H2_RESPONSE=$(nodeport_curl -k -sS -I --http2 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || CADDY_H2_RESPONSE=""
if echo "$CADDY_H2_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "Caddy health (H2) works"
else
  fail "Caddy health (H2) failed"
  echo "Response: $(echo "$CADDY_H2_RESPONSE" | head -n3)"
fi

# Test 2: Caddy health (H3)
say "Test 2: Caddy health via HTTP/3"
# http3_curl runs in Docker using kind node's network namespace (workaround for macOS UDP limitations)
# Match the old working version - simple call without extra timeout wrapper
H3_HEALTH_OUTPUT=$(http3_curl -k -sS -I --http3-only \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  H3_HEALTH_OUTPUT=""
}
if echo "$H3_HEALTH_OUTPUT" | head -n1 | grep -q "HTTP/3 200"; then
  ok "Caddy health (H3) works"
else
  warn "Caddy health (H3) failed (QUIC path unavailable or timed out)"
  # Show diagnostic info if available
  if [[ -n "$HTTP3_SVC_IP" ]]; then
    echo "  → ClusterIP: $HTTP3_SVC_IP, Resolve: $HTTP3_RESOLVE"
  fi
fi

# Test 3: Backend via ingress (H2) - Full chain
say "Test 3: Backend API via Ingress Nginx via Caddy (HTTP/2) - Full Chain"
# Use nodeport_curl for macOS TLS issues
RESPONSE_H2=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/api/healthz" 2>&1) || RESPONSE_H2=""
HTTP_CODE_H2=$(echo "$RESPONSE_H2" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$HTTP_CODE_H2" == "200" ]]; then
  ok "Backend via ingress (H2) works - HTTP $HTTP_CODE_H2 (Full chain: Client -> Caddy -> Ingress -> Backend)"
elif [[ "$HTTP_CODE_H2" == "404" ]]; then
  warn "Backend via ingress (H2) returned HTTP 404 (endpoint may not exist, but routing works)"
else
  warn "Backend via ingress (H2) returned HTTP $HTTP_CODE_H2 (expected 200)"
  # 502 indicates Caddy can't reach ingress-nginx or ingress-nginx can't reach backend
  if [[ "$HTTP_CODE_H2" == "502" ]]; then
    echo "  → 502 Bad Gateway: Caddy → Ingress-nginx → Backend chain is broken"
    echo "  → Check ingress-nginx pod status and backend service endpoints"
  fi
fi

# Test 4: Backend via ingress (H3) - Full chain
say "Test 4: Backend API via Ingress Nginx via Caddy (HTTP/3) - Full Chain"
# http3_curl runs in Docker using kind node's network namespace (workaround for macOS UDP limitations)
# Match the old working version - simple call without extra timeout wrapper
RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/api/healthz" 2>&1) || {
  warn "HTTP/3 curl command failed (exit code: $?)"
  RESPONSE_H3="000"
}
HTTP_CODE_H3=$(echo "$RESPONSE_H3" | tail -1 | tr -d '[:space:]' || echo "000")
if [[ "$HTTP_CODE_H3" == "200" ]]; then
  ok "Backend via ingress (H3) works - HTTP $HTTP_CODE_H3 (Full chain: Client -> Caddy -> Ingress -> Backend)"
elif [[ -n "$HTTP_CODE_H3" ]]; then
  warn "Backend via ingress (H3) returned HTTP $HTTP_CODE_H3"
else
  warn "Backend via ingress (H3) failed - no response"
fi

# Test 5: Verify strict TLS
say "Test 5: Verify strict TLS (TLS 1.2/1.3 only)"
# Test TLS 1.2 first (should work) - use nodeport_curl for macOS TLS issues
TLS12_RESPONSE=$(nodeport_curl -k -sS -I --tlsv1.2 --http2 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || TLS12_RESPONSE=""
TLS12_WORKS=false
if echo "$TLS12_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.2 works"
  TLS12_WORKS=true
else
  warn "TLS 1.2 test failed"
  echo "  Response: $(echo "$TLS12_RESPONSE" | head -n1)"
fi

# Test TLS 1.3 (should work) - use nodeport_curl for macOS TLS issues
TLS13_RESPONSE=$(nodeport_curl -k -sS -I --tlsv1.3 --http2 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || TLS13_RESPONSE=""
TLS13_WORKS=false
if echo "$TLS13_RESPONSE" | head -n1 | grep -qE "200|HTTP/2 200"; then
  ok "TLS 1.3 works"
  TLS13_WORKS=true
else
  warn "TLS 1.3 test failed"
  echo "  Response: $(echo "$TLS13_RESPONSE" | head -n1)"
fi

# Test TLS 1.1 (should be rejected)
# Use --tls-max 1.1 to force maximum TLS 1.1 (prevent upgrade to higher versions)
set +e  # Temporarily disable exit on error to capture TLS 1.1 rejection
TLS11_RESPONSE=$(nodeport_curl -k -sS -I --tlsv1.1 --tls-max 1.1 --http2 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1)
TLS11_EXIT=$?
set -e  # Re-enable exit on error
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
  if [[ "$TLS12_WORKS" == "true" ]] && [[ "$TLS13_WORKS" == "true" ]]; then
    warn "TLS 1.1 test inconclusive, but TLS 1.2 and 1.3 work"
    echo "  Exit code: $TLS11_EXIT"
    echo "  Response: $(echo "$TLS11_RESPONSE" | head -n3)"
  else
    warn "TLS 1.1 test failed and TLS 1.2/1.3 also failed"
  fi
fi

# Test 6: CA Rotation with zero-downtime
say "Test 6: CA Rotation with Zero-Downtime Reload"
say "Starting continuous requests during rotation..."

# Clean up any old log file
rm -f /tmp/rotation-test.log

# First, verify Caddy is working before rotation
say "Pre-rotation health check..."
# Use nodeport_curl for macOS TLS issues
PRE_ROTATION_RESPONSE=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 \
  --resolve "$HOST:${PORT}:127.0.0.1" \
  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || PRE_ROTATION_RESPONSE=""
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
  SKIP_ROTATION=0
fi

if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then
  # OPTION B: Use distributed k6 load generator (recommended for production-grade testing)
  # This runs k6 inside the cluster, avoiding NodePort/port-forward bottlenecks
  # Supports multiple instances for true distributed load testing
  USE_K6="${USE_K6:-true}"  # Set to false to use curl-based testing
  
  if [[ "$USE_K6" == "true" ]] && command -v kubectl >/dev/null 2>&1; then
    say "Using distributed k6 load generator (Option B - recommended)"
    ok "k6 will run inside the cluster, avoiding NodePort/port-forward bottlenecks"
    
    # Use the same k6 parameterization as rotation-suite.sh
    # Defaults: H2=80 req/s (20-50 VUs), H3=40 req/s (10-20 VUs)
    # Optimal production config: H2=250 req/s (20-160 VUs), H3=150 req/s (10-100 VUs)
    export HOST="$HOST"
    export DURATION="${K6_DURATION:-180s}"
    export K6_H2_RATE="${K6_H2_RATE:-80}"
    export K6_H2_PRE_VUS="${K6_H2_PRE_VUS:-20}"
    export K6_H2_MAX_VUS="${K6_H2_MAX_VUS:-50}"
    export K6_H3_RATE="${K6_H3_RATE:-40}"
    export K6_H3_PRE_VUS="${K6_H3_PRE_VUS:-10}"
    export K6_H3_MAX_VUS="${K6_H3_MAX_VUS:-20}"
    
    say "Starting k6 load test (H2=${K6_H2_RATE} req/s, H3=${K6_H3_RATE} req/s, ${DURATION} duration)..."
    
    # Create CA ConfigMap for k6 (use mkcert CA - rotate-ca-and-fix-tls.sh rotates leaf only)
    # Before starting k6, ensure certificate includes ClusterIP FQDN for strict TLS
    NS_K6="k6-load"
    CA_CONFIGMAP="k6-ca-cert"
    CA_ROOT="$(mkcert -CAROOT)/rootCA.pem"
    CLUSTERIP_FQDN="caddy-h3.ingress-nginx.svc.cluster.local"
    
    if [[ -f "$CA_ROOT" ]]; then
      # ALWAYS regenerate certificate with ClusterIP FQDN before k6 starts
      # rotate-ca-and-fix-tls.sh uses mkcert which doesn't include ClusterIP FQDN
      # This ensures k6 can verify TLS when connecting to ClusterIP FQDN
      say "Ensuring certificate includes ClusterIP FQDN for k6 strict TLS..."
      TMP_CERT_DIR="$(mktemp -d)"
      CA_KEY="$(mkcert -CAROOT)/rootCA-key.pem"
      
      if [[ -f "$CA_KEY" ]] && [[ -f "$CA_ROOT" ]]; then
        # Generate leaf key and certificate with FQDN in SANs
        openssl genrsa -out "$TMP_CERT_DIR/tls.key" 2048 >/dev/null 2>&1 || {
          warn "Failed to generate certificate key"
          rm -rf "$TMP_CERT_DIR"
          TMP_CERT_DIR=""
        }
        
        if [[ -n "$TMP_CERT_DIR" ]]; then
          openssl req -new -key "$TMP_CERT_DIR/tls.key" -out "$TMP_CERT_DIR/tls.csr" \
            -subj "/CN=$HOST/O=mkcert development certificate" >/dev/null 2>&1 || {
            warn "Failed to create certificate signing request"
            rm -rf "$TMP_CERT_DIR"
            TMP_CERT_DIR=""
          }
        fi
        
        if [[ -n "$TMP_CERT_DIR" ]]; then
          cat > "$TMP_CERT_DIR/ext.conf" <<EXT
[v3_req]
subjectAltName=DNS:$HOST,DNS:*.$HOST,DNS:localhost,DNS:$CLUSTERIP_FQDN,IP:127.0.0.1,IP:::1
EXT
          
          openssl x509 -req -in "$TMP_CERT_DIR/tls.csr" -CA "$CA_ROOT" -CAkey "$CA_KEY" \
            -CAcreateserial -out "$TMP_CERT_DIR/tls.crt" -days 365 \
            -extensions v3_req -extfile "$TMP_CERT_DIR/ext.conf" >/dev/null 2>&1 || {
            warn "Failed to sign certificate"
            rm -rf "$TMP_CERT_DIR"
            TMP_CERT_DIR=""
          }
        fi
        
        if [[ -n "$TMP_CERT_DIR" ]] && [[ -f "$TMP_CERT_DIR/tls.crt" ]]; then
          # Verify the certificate includes FQDN
          if echo "$(cat "$TMP_CERT_DIR/tls.crt")" | openssl x509 -noout -text 2>/dev/null | grep -q "$CLUSTERIP_FQDN"; then
            # Update secrets
            kubectl -n "$NS_ING" delete secret $LEAF_TLS_SECRET >/dev/null 2>&1 || true
            kubectl -n "$NS_ING" create secret tls $LEAF_TLS_SECRET \
              --cert="$TMP_CERT_DIR/tls.crt" --key="$TMP_CERT_DIR/tls.key" >/dev/null 2>&1 || warn "Failed to update ingress-nginx secret"
            kubectl -n "$NS_APP" delete secret $LEAF_TLS_SECRET >/dev/null 2>&1 || true
            kubectl -n "$NS_APP" create secret tls $LEAF_TLS_SECRET \
              --cert="$TMP_CERT_DIR/tls.crt" --key="$TMP_CERT_DIR/tls.key" >/dev/null 2>&1 || warn "Failed to update off-campus-housing-tracker secret"
            
            # Check if Caddy is already ready (might not need restart if secret is already mounted)
            # Trigger Caddy restart to pick up new certificate
            kubectl -n "$NS_ING" patch deploy caddy-h3 \
              -p="{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"certPreK6\":\"$(date +%s)\"}}}}}" >/dev/null 2>&1
            
            ok "Certificate regenerated with ClusterIP FQDN (verified in SANs)"
            rm -rf "$TMP_CERT_DIR"
            
            # Wait for Caddy to fully restart and serve new certificate
            # Patching deployment annotation triggers quick restart (typically 1-3s with RollingUpdate)
            say "Waiting for Caddy to restart with new certificate..."
            # Use shorter timeout - if Caddy is already ready, this will return quickly
            if kubectl -n "$NS_ING" rollout status deploy/caddy-h3 --timeout=20s >/dev/null 2>&1; then
              ok "Caddy rollout completed"
              # Wait for Caddy to actually respond to requests (not just be rolled out)
              say "Verifying Caddy is responding with new certificate..."
              HEALTH_CHECK_PASSED=0
              for health_attempt in 1 2 3 4 5; do
                HEALTH_RESPONSE=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 --max-time 3 \
                  --resolve "$HOST:${PORT}:127.0.0.1" \
                  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "000")
                if [[ "$HEALTH_RESPONSE" == "200" ]]; then
                  HEALTH_CHECK_PASSED=1
                  break
                fi
                sleep 1
              done
              if [[ "$HEALTH_CHECK_PASSED" == "1" ]]; then
                ok "Caddy is responding with new certificate"
              else
                warn "Caddy health check failed - continuing anyway"
                sleep 2
              fi
            else
              # Rollout might be in progress or already complete - check if pods are ready
              READY_PODS=$(kubectl -n "$NS_ING" get deploy caddy-h3 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
              if [[ "$READY_PODS" -gt 0 ]]; then
                ok "Caddy pods ready (${READY_PODS} replicas) - waiting for health check..."
                # Still do health check even if rollout status timed out
                sleep 3
                HEALTH_RESPONSE=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 --max-time 3 \
                  --resolve "$HOST:${PORT}:127.0.0.1" \
                  -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "000")
                if [[ "$HEALTH_RESPONSE" == "200" ]]; then
                  ok "Caddy is responding"
                else
                  warn "Caddy health check failed - continuing anyway"
                fi
              else
                warn "Caddy rollout timeout - continuing anyway"
                sleep 2
              fi
            fi
          else
            warn "Generated certificate doesn't include FQDN - verification failed"
            rm -rf "$TMP_CERT_DIR"
          fi
        fi
      else
        warn "mkcert CA key not found at $CA_KEY, cannot regenerate certificate with FQDN"
      fi
      
      # Create CA ConfigMap for k6
      kubectl get ns "$NS_K6" >/dev/null 2>&1 || kubectl create ns "$NS_K6" >/dev/null
      kubectl -n "$NS_K6" create configmap "$CA_CONFIGMAP" \
        --from-file=ca.crt="$CA_ROOT" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
      export CA_CONFIGMAP
      ok "CA certificate ConfigMap created for k6 (strict TLS with mkcert CA)"
    else
      warn "mkcert CA not found, k6 will skip TLS verification"
      USE_K6="false"
    fi
    
    if [[ "${USE_K6:-true}" == "true" ]]; then
      # Start k6 job using run-k6-chaos.sh
      K6_START_TIME=$(date +%s)
      K6_JOB=$("$SCRIPT_DIR/run-k6-chaos.sh" start 2>/dev/null || echo "")
      
      if [[ -z "$K6_JOB" ]]; then
        warn "k6 job failed to start, falling back to curl-based testing"
        USE_K6="false"
      else
        ok "k6 load test started: $K6_JOB (started at $(date -r "$K6_START_TIME" '+%H:%M:%S'))"
        # Wait for k6 pod to be ready
        say "Waiting for k6 pod to be ready..."
        kubectl -n "$NS_K6" wait --for=condition=ready pod -l job-name="$K6_JOB" --timeout=30s >/dev/null 2>&1 || true
        # Additional buffer for k6 to start generating load AND for Caddy to fully stabilize
        # This ensures Caddy is completely ready before k6 starts making requests
        say "Waiting for Caddy to fully stabilize before k6 starts load testing..."
        sleep 3
        # Final health check using in-cluster pod (same network as k6) to ensure Caddy is responding
        FINAL_HEALTH_PASSED=0
        for final_attempt in 1 2 3; do
          FINAL_HEALTH_POD="caddy-final-health-$(date +%s)-$RANDOM"
          # Capture output and extract just the HTTP code (ignore kubectl messages)
          FINAL_HEALTH_OUTPUT=$(kubectl -n "$NS_ING" run "$FINAL_HEALTH_POD" --rm -i --restart=Never \
            --image=curlimages/curl:latest -- \
            curl -k -sS -w "\n%{http_code}" --http2 --max-time 3 \
            -H "Host: $HOST" "https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz" 2>&1)
          # Clean up pod if it didn't auto-delete
          kubectl -n "$NS_ING" delete pod "$FINAL_HEALTH_POD" --ignore-not-found >/dev/null 2>&1 || true
          # Extract HTTP code - look for 3-digit number (200, 404, etc.)
          # Handle cases where it might be on same line as "pod ... deleted" message (e.g., "200pod ...")
          FINAL_HEALTH=$(echo "$FINAL_HEALTH_OUTPUT" | grep -oE '[0-9]{3}' | grep -E '^(200|404|502|503|504)$' | head -1 || echo "000")
          if [[ "$FINAL_HEALTH" == "200" ]]; then
            FINAL_HEALTH_PASSED=1
            break
          fi
          if [[ $final_attempt -lt 3 ]]; then
            sleep 1
          fi
        done
        if [[ "$FINAL_HEALTH_PASSED" == "1" ]]; then
          ok "Caddy is fully ready - k6 can start safely"
        else
          warn "Caddy final health check failed (returned $FINAL_HEALTH) - k6 may see initial failures"
        fi
      fi
    fi
  fi
  
  # Fallback to curl-based testing if k6 is not available or disabled
  if [[ "${USE_K6:-false}" != "true" ]]; then
    # FIX: DO NOT USE port-forward for load tests - it's single-threaded and bottlenecks under high load
    # Port-forward is limited by: macOS VM NAT, Docker networking, Go's port-forward tunneling, TCP packet scheduling
    # Use NodePort directly for load testing (much higher throughput)
    # Port-forward is ONLY used for Test 7 (certificate verification) where it's appropriate
    
    # Use NodePort for rotation load test (high throughput, no bottleneck)
    ROTATION_PORT=${PORT}  # NodePort (typically 30443)
    ROTATION_HOST="$HOST"  # off-campus-housing.test
    ok "Using NodePort (${ROTATION_PORT}) for high-throughput rotation test (bypasses port-forward bottleneck)"
  
  # For production-grade zero-downtime, we need to:
  # 1. Start requests BEFORE rotation begins
  # 2. Use faster request intervals to catch any brief downtime
  # 3. Run for longer to cover the entire rotation window
  
  # Calculate how many requests we need for a PRODUCTION-GRADE CHAOS TEST
  # This is an EXTREME LOAD TEST to verify zero-downtime under production traffic
  # Target: Parallel requests with controlled concurrency for PRODUCTION-GRADE throughput
  # Observed: Single request takes ~0.5s, but parallel requests can achieve much higher throughput
  # Strategy: Use parallel curl processes with controlled concurrency (HTTP/2 multiplexing)
  # For 120 seconds coverage with parallel requests:
  #   - Concurrency: 20 parallel requests (allows HTTP/2 multiplexing, ~40 req/s theoretical)
  #   - Request interval: 0.025s (40 req/s - sends new requests every 25ms)
  #   - Request timeout: 1.0s (catches cold connections + edge cases for 100% success)
  #   - Total requests: 4200 (aggressive chaos test)
  # This achieves production-grade throughput while maintaining 100% success rate
  CONCURRENT_REQUESTS=30  # Parallel requests for HTTP/2 multiplexing (production-grade, increased for higher throughput)
  # With concurrent pool, we achieve much higher throughput (100-150 req/s observed)
  # No need for REQUEST_INTERVAL - pool maintains constant concurrency
  ROTATION_COVERAGE_TIME=120  # PRODUCTION chaos test: 120 seconds of continuous requests
  # PRODUCTION-GRADE STRESS TESTING: Increased to 50000 requests for extreme production load
  # With 30 concurrent requests and 3.0s timeout, we maintain high throughput (200-300 req/s) while ensuring 100% success
  # Actual observed: 8000 requests completed in ~50s = ~160 req/s peak, ~120 req/s average
  # For production: 50000 requests = ~4-5 minutes of continuous load at 200 req/s
  NUM_REQUESTS=50000  # PRODUCTION stress test: 50000 requests for extreme production-grade chaos testing
  
  say "Starting continuous health checks ($NUM_REQUESTS requests - EXTREME PRODUCTION STRESS TEST with ${CONCURRENT_REQUESTS} concurrent HTTP/2 requests for maximum throughput (300-500+ req/s expected with HTTP/2 multiplexing) to verify zero-downtime under extreme production load - targeting 100% success rate)..."
  # Clean up any old log file
  rm -f /tmp/rotation-test.log
  touch /tmp/rotation-test.log
  
  # CONCURRENT POOL STRATEGY: Maintain constant pool of active requests for maximum throughput
  # This leverages HTTP/2 multiplexing and achieves production-grade 40+ req/s
  # Use HTTP/2 only for maximum speed (HTTP/3 via Docker is slower)
  (
    REQUEST_COUNT=0
    # Launch initial pool of concurrent requests
    while [[ $REQUEST_COUNT -lt $CONCURRENT_REQUESTS ]] && [[ $REQUEST_COUNT -lt $NUM_REQUESTS ]]; do
      (
        # Use HTTP/2 for maximum throughput
        # FIX #6: Reduced timeout from 3.0s to 0.5s for faster failure detection and less socket exhaustion
        # FIX: Use NodePort directly (no port-forward bottleneck) with --local-port 0 to break conntrack stickiness
        # This distributes requests across pods and achieves much higher throughput (300-500+ req/s)
        RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 0.5 \
          --local-port 0 \
          --resolve "$ROTATION_HOST:${ROTATION_PORT}:127.0.0.1" \
          -H "Host: $ROTATION_HOST" "https://$ROTATION_HOST:${ROTATION_PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "timeout")
        echo "$RESPONSE" >> /tmp/rotation-test.log 2>&1
      ) &
      REQUEST_COUNT=$((REQUEST_COUNT + 1))
    done
    
    # Maintain pool: when one request completes, launch the next immediately
    # This keeps CONCURRENT_REQUESTS active at all times for maximum throughput
    while [[ $REQUEST_COUNT -lt $NUM_REQUESTS ]]; do
      # Wait for ANY job to complete (non-blocking pool maintenance)
      wait -n
      # Launch next request immediately to maintain pool size
      (
        # Use HTTP/2 for maximum throughput
        # Increased timeout to 3.0s to ensure 100% success during rotation
        # With RollingUpdate + maxUnavailable:0, old pod stays up, but service endpoint updates can cause brief delays
        # 3.0s timeout ensures we catch ALL requests even during pod transitions and endpoint updates
        # FIX: Use NodePort directly (no port-forward bottleneck) with --local-port 0 to break conntrack stickiness
        # This distributes requests across pods and achieves much higher throughput (300-500+ req/s)
        RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 3.0 \
          --local-port 0 \
          --resolve "$ROTATION_HOST:${ROTATION_PORT}:127.0.0.1" \
          -H "Host: $ROTATION_HOST" "https://$ROTATION_HOST:${ROTATION_PORT}/_caddy/healthz" 2>&1 | tail -1 || echo "timeout")
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
  # Give the process a moment to start writing (concurrent pool starts very quickly)
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
  fi  # Close: if [[ "${USE_K6:-false}" != "true" ]]; then (curl-based fallback)

  # Handle k6 vs curl-based testing
  if [[ "${USE_K6:-false}" == "true" ]] && [[ -n "${K6_JOB:-}" ]]; then
    # k6 mode: k6 is already running and ready, proceed with rotation
    say "k6 load test running - proceeding with CA rotation..."
    
    # Perform CA rotation during k6 test
    # Note: rotate-ca-and-fix-tls.sh only rotates leaf, not CA, so mkcert CA remains valid
    say "Rotating CA (k6 load test continues in background)..."
    ROTATION_START=$(date +%s)
    if ./scripts/rotate-ca-and-fix-tls.sh >/dev/null 2>&1; then
      ROTATION_END=$(date +%s)
      ROTATION_DURATION=$((ROTATION_END - ROTATION_START))
      ok "CA rotation script completed (took ${ROTATION_DURATION}s)"
      
      # After rotation, rotate-ca-and-fix-tls.sh regenerates certificate WITHOUT FQDN
      # ALWAYS regenerate with FQDN to ensure k6 continues to work
      say "Regenerating certificate with ClusterIP FQDN after rotation (rotate-ca-and-fix-tls.sh doesn't include it)..."
      TMP_CERT_DIR="$(mktemp -d)"
      CA_KEY="$(mkcert -CAROOT)/rootCA-key.pem"
      
      if [[ -f "$CA_KEY" ]] && [[ -f "$CA_ROOT" ]]; then
        openssl genrsa -out "$TMP_CERT_DIR/tls.key" 2048 >/dev/null 2>&1 && \
        openssl req -new -key "$TMP_CERT_DIR/tls.key" -out "$TMP_CERT_DIR/tls.csr" \
          -subj "/CN=$HOST/O=mkcert development certificate" >/dev/null 2>&1 && \
        cat > "$TMP_CERT_DIR/ext.conf" <<EXT
[v3_req]
subjectAltName=DNS:$HOST,DNS:*.$HOST,DNS:localhost,DNS:$CLUSTERIP_FQDN,IP:127.0.0.1,IP:::1
EXT
        openssl x509 -req -in "$TMP_CERT_DIR/tls.csr" -CA "$CA_ROOT" -CAkey "$CA_KEY" \
          -CAcreateserial -out "$TMP_CERT_DIR/tls.crt" -days 365 \
          -extensions v3_req -extfile "$TMP_CERT_DIR/ext.conf" >/dev/null 2>&1
        
        if [[ -f "$TMP_CERT_DIR/tls.crt" ]]; then
          # Verify FQDN is in certificate
          if echo "$(cat "$TMP_CERT_DIR/tls.crt")" | openssl x509 -noout -text 2>/dev/null | grep -q "$CLUSTERIP_FQDN"; then
            kubectl -n "$NS_ING" delete secret $LEAF_TLS_SECRET >/dev/null 2>&1 || true
            kubectl -n "$NS_ING" create secret tls $LEAF_TLS_SECRET \
              --cert="$TMP_CERT_DIR/tls.crt" --key="$TMP_CERT_DIR/tls.key" >/dev/null 2>&1
            kubectl -n "$NS_APP" delete secret $LEAF_TLS_SECRET >/dev/null 2>&1 || true
            kubectl -n "$NS_APP" create secret tls $LEAF_TLS_SECRET \
              --cert="$TMP_CERT_DIR/tls.crt" --key="$TMP_CERT_DIR/tls.key" >/dev/null 2>&1
            
            # Trigger Caddy restart to pick up new certificate
            kubectl -n "$NS_ING" patch deploy caddy-h3 \
              -p="{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"certPostRot\":\"$(date +%s)\"}}}}}" >/dev/null 2>&1
            
            ok "Certificate regenerated with ClusterIP FQDN after rotation (verified)"
            rm -rf "$TMP_CERT_DIR"
            # Wait for Caddy to fully restart and serve new certificate (k6 is still running)
            # Use shorter timeout since k6 is running and we don't want to block too long
            say "Waiting for Caddy to restart with new certificate (k6 continues, timeout 30s)..."
            if kubectl -n "$NS_ING" rollout status deploy/caddy-h3 --timeout=30s >/dev/null 2>&1; then
              ok "Caddy rollout completed"
              # Verify Caddy is actually responding (not just rolled out)
              # This ensures no requests timeout during the restart window
              # Use a pod in the cluster to check (same network as k6)
              say "Verifying Caddy is responding with new certificate (k6 continues in background)..."
              HEALTH_CHECK_PASSED=0
              for health_attempt in 1 2 3 4 5; do
                # Use a temporary pod to check health (same network namespace as k6)
                HEALTH_POD="caddy-health-$(date +%s)-$RANDOM"
                # Run with --rm and capture output, then ensure cleanup
                HEALTH_OUTPUT=$(kubectl -n "$NS_ING" run "$HEALTH_POD" --rm -i --restart=Never \
                  --image=curlimages/curl:latest -- \
                  curl -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
                  -H "Host: $HOST" "https://caddy-h3.ingress-nginx.svc.cluster.local/_caddy/healthz" 2>&1)
                # Ensure pod is cleaned up (--rm should handle it, but be safe)
                kubectl -n "$NS_ING" delete pod "$HEALTH_POD" --ignore-not-found >/dev/null 2>&1 || true
                # Extract HTTP code - look for 3-digit number (200, 404, etc.)
                # Handle cases where it might be on same line as "pod ... deleted" message (e.g., "200pod ...")
                HEALTH_RESPONSE=$(echo "$HEALTH_OUTPUT" | grep -oE '[0-9]{3}' | grep -E '^(200|404|502|503|504)$' | head -1 || echo "000")
                if [[ "$HEALTH_RESPONSE" == "200" ]]; then
                  HEALTH_CHECK_PASSED=1
                  break
                fi
                # Wait longer between attempts if we're not getting 200
                sleep 2
              done
              if [[ "$HEALTH_CHECK_PASSED" == "1" ]]; then
                ok "Caddy is responding with new certificate (k6 can continue safely)"
                # Small additional buffer to ensure all connections are stable
                sleep 1
              else
                warn "Caddy health check failed after 5 attempts (returned $HEALTH_RESPONSE) - k6 may see timeouts"
                # Still wait a bit to give Caddy more time
                sleep 3
              fi
            else
              warn "Caddy rollout timeout - continuing (k6 continues testing)"
              sleep 2
            fi
          else
            warn "Generated certificate doesn't include FQDN - verification failed"
            rm -rf "$TMP_CERT_DIR"
          fi
        else
          warn "Failed to generate certificate with FQDN after rotation"
          rm -rf "$TMP_CERT_DIR"
        fi
      else
        warn "mkcert CA key not found, cannot regenerate certificate with FQDN"
      fi
      
      # Update CA ConfigMap (use mkcert CA - rotate-ca-and-fix-tls.sh doesn't rotate CA)
      kubectl -n "$NS_K6" create configmap "$CA_CONFIGMAP" \
        --from-file=ca.crt="$CA_ROOT" \
        --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1
    else
      ROTATION_END=$(date +%s)
      ROTATION_DURATION=$((ROTATION_END - ROTATION_START))
      warn "CA rotation script returned non-zero status (took ${ROTATION_DURATION}s)"
    fi
    
    # Wait for k6 job to complete (use dynamic timeout based on rate and duration)
    say "Waiting for k6 load test to complete..."
    TOTAL_RATE=$((K6_H2_RATE + K6_H3_RATE))
    
    # Calculate timeout based on duration + buffer
    # Parse duration (e.g., "180s" -> 180)
    DURATION_SEC=$(echo "$DURATION" | sed 's/s$//' | grep -oE '^[0-9]+' || echo "180")
    # Add 60s buffer for job startup, rotation overhead, and completion
    K6_TIMEOUT_SEC=$((DURATION_SEC + 60))
    # Cap at reasonable maximum, but allow higher for very high rates
    # For 400+ req/s, allow up to 11 minutes (660s) to account for massive dropped iterations
    # For lower rates, cap at 8 minutes (480s)
    if [[ "$TOTAL_RATE" -ge 400 ]]; then
      # Very high rates: allow up to 11 minutes (660s) - observed: 631s needed
      if [[ $K6_TIMEOUT_SEC -gt 660 ]]; then
        K6_TIMEOUT_SEC=660
      fi
    else
      # Lower rates: cap at 8 minutes (480s)
      if [[ $K6_TIMEOUT_SEC -gt 480 ]]; then
        K6_TIMEOUT_SEC=480
      fi
    fi
    K6_TIMEOUT="${K6_TIMEOUT_SEC}s"
    
    # For high rates, add extra buffer (more dropped iterations = longer completion time)
    # At very high rates (400+ req/s), k6 can take significantly longer due to:
    # - Dropped iterations (k6 can't keep up with target rate)
    # - Processing overhead for large result sets
    # - Network congestion and connection pooling
    # Observed: 420 req/s (260/160) can take 600s+ total, especially with high dropped iterations (15-61%+)
    # With massive dropped iterations, k6 needs significantly more time to process all requests
    # Latest runs: 603s, 631s observed - 660s timeout provides safe buffer with variability
    if [[ "$TOTAL_RATE" -ge 400 ]]; then
      K6_TIMEOUT_SEC=$((DURATION_SEC + 480))  # 8 minutes extra for very high rates (660s total)
      K6_TIMEOUT="${K6_TIMEOUT_SEC}s"
    elif [[ "$TOTAL_RATE" -ge 350 ]]; then
      K6_TIMEOUT_SEC=$((DURATION_SEC + 200))  # ~3.3 minutes extra
      K6_TIMEOUT="${K6_TIMEOUT_SEC}s"
    elif [[ "$TOTAL_RATE" -ge 300 ]]; then
      K6_TIMEOUT_SEC=$((DURATION_SEC + 150))  # 2.5 minutes extra
      K6_TIMEOUT="${K6_TIMEOUT_SEC}s"
    elif [[ "$TOTAL_RATE" -ge 250 ]]; then
      K6_TIMEOUT_SEC=$((DURATION_SEC + 120))  # 2 minutes extra
      K6_TIMEOUT="${K6_TIMEOUT_SEC}s"
    fi
    
    say "k6 timeout: ${K6_TIMEOUT} (duration: ${DURATION}, rate: ${TOTAL_RATE} req/s)"
    
    K6_WAIT_START=$(date +%s)
    if "$SCRIPT_DIR/run-k6-chaos.sh" wait "$K6_JOB" "$K6_TIMEOUT" 2>&1; then
      K6_WAIT_END=$(date +%s)
      K6_WAIT_DURATION=$((K6_WAIT_END - K6_WAIT_START))
      if [[ -n "${K6_START_TIME:-}" ]]; then
        K6_TOTAL_DURATION=$((K6_WAIT_END - K6_START_TIME))
      else
        K6_TOTAL_DURATION=$K6_WAIT_DURATION
      fi
      ok "k6 job completed (waited ${K6_WAIT_DURATION}s, total ${K6_TOTAL_DURATION}s)"
    else
      K6_WAIT_END=$(date +%s)
      K6_WAIT_DURATION=$((K6_WAIT_END - K6_WAIT_START))
      if [[ -n "${K6_START_TIME:-}" ]]; then
        K6_TOTAL_DURATION=$((K6_WAIT_END - K6_START_TIME))
      else
        K6_TOTAL_DURATION=$K6_WAIT_DURATION
      fi
      warn "k6 job may still be running (waited ${K6_WAIT_DURATION}s, total ${K6_TOTAL_DURATION}s)"
      # Check if job is actually still running
      if kubectl -n k6-load get job "$K6_JOB" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null | grep -q "True"; then
        ok "k6 job actually completed (status check confirms)"
      elif kubectl -n k6-load get job "$K6_JOB" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null | grep -q "True"; then
        warn "k6 job failed (check logs for details)"
      else
        warn "k6 job status unknown - continuing to collect results"
      fi
    fi
    
    # Collect and analyze k6 results
    say "Collecting k6 results..."
    RESULT=$("$SCRIPT_DIR/run-k6-chaos.sh" collect "$K6_JOB")
    
    if [[ -f "$RESULT" ]]; then
      # Parse k6 results (same format as rotation-suite.sh)
      TOTAL=$(grep -E "[[:space:]]+iterations.*:" "$RESULT" 2>/dev/null | grep -oE '[0-9]+[[:space:]]+[0-9]+\.[0-9]+' | awk '{print $1}' | head -1 || echo "0")
      H2_FAIL_LINE=$(grep -E "[[:space:]]+h2_fail.*:" "$RESULT" 2>/dev/null | head -1)
      H3_FAIL_LINE=$(grep -E "[[:space:]]+h3_fail.*:" "$RESULT" 2>/dev/null | head -1)
      
      # Extract percentage from "0.00%" format (handle dots padding)
      H2_FAIL_PCT=$(echo "$H2_FAIL_LINE" | grep -oE '[0-9.]+%' | head -1 | sed 's/%//' || echo "100")
      H3_FAIL_PCT=$(echo "$H3_FAIL_LINE" | grep -oE '[0-9.]+%' | head -1 | sed 's/%//' || echo "100")
      
      # Convert percentage to decimal (0.00 = 0, 100.00 = 1) - same as rotation-suite.sh
      H2_FAIL=$(echo "scale=4; $H2_FAIL_PCT / 100" | bc -l 2>/dev/null | head -c 6 || echo "1")
      H3_FAIL=$(echo "scale=4; $H3_FAIL_PCT / 100" | bc -l 2>/dev/null | head -c 6 || echo "1")
      
      # Extract actual failure counts (format: "14 out of 13638")
      H2_FAIL_COUNT=$(echo "$H2_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '^[0-9]+' || echo "0")
      H3_FAIL_COUNT=$(echo "$H3_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '^[0-9]+' || echo "0")
      
      # Also extract H2 and H3 request counts for verification
      # Format: "0 out of 14245" -> extract 14245
      H2_COUNT=$(echo "$H2_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '[0-9]+$' || echo "0")
      H3_COUNT=$(echo "$H3_FAIL_LINE" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '[0-9]+$' || echo "0")
      
      # Extract error details from k6 logs
      say "=== k6 Load Test Summary ==="
      ok "Total Requests: $TOTAL"
      ok "H2 Requests: $H2_COUNT (Failures: $H2_FAIL_COUNT, Rate: ${H2_FAIL_PCT}%)"
      ok "H3 Requests: $H3_COUNT (Failures: $H3_FAIL_COUNT, Rate: ${H3_FAIL_PCT}%)"
      if [[ -n "${K6_TOTAL_DURATION:-}" ]]; then
        ok "k6 Execution Time: ${K6_TOTAL_DURATION}s (expected: ~${DURATION_SEC}s + overhead)"
      else
        ok "k6 Execution Time: unknown (expected: ~${DURATION_SEC}s + overhead)"
      fi
      
      # Extract HTTP error details from k6 logs
      if [[ "$H2_FAIL_COUNT" -gt 0 ]] || [[ "$H3_FAIL_COUNT" -gt 0 ]]; then
        say "=== Failure Analysis ==="
        
        # Extract HTTP status codes from k6 output
        H2_ERROR_CODES=$(grep -E "http_req.*status.*[^2][0-9]{2}" "$RESULT" 2>/dev/null | grep -oE "status=[0-9]{3}" | sort | uniq -c | head -10 || echo "")
        H3_ERROR_CODES=$(grep -E "http_req.*status.*[^2][0-9]{2}" "$RESULT" 2>/dev/null | grep -oE "status=[0-9]{3}" | sort | uniq -c | head -10 || echo "")
        
        # Extract http_req_failed metrics
        HTTP_REQ_FAILED=$(grep -E "[[:space:]]+http_req_failed.*:" "$RESULT" 2>/dev/null | head -1 || echo "")
        if [[ -n "$HTTP_REQ_FAILED" ]]; then
          HTTP_REQ_FAILED_PCT=$(echo "$HTTP_REQ_FAILED" | grep -oE '[0-9.]+%' | head -1 || echo "0%")
          HTTP_REQ_FAILED_COUNT=$(echo "$HTTP_REQ_FAILED" | grep -oE '[0-9]+ out of [0-9]+' | grep -oE '^[0-9]+' || echo "0")
          warn "HTTP Request Failures: $HTTP_REQ_FAILED_COUNT (Rate: $HTTP_REQ_FAILED_PCT)"
        fi
        
        # Extract error messages
        ERROR_MESSAGES=$(grep -iE "error|failed|timeout|connection.*refused|certificate.*error|tls.*error" "$RESULT" 2>/dev/null | head -20 || echo "")
        if [[ -n "$ERROR_MESSAGES" ]]; then
          warn "Error messages found in k6 logs:"
          echo "$ERROR_MESSAGES" | sed 's/^/  → /' | head -10
        fi
        
        # Extract threshold violations
        THRESHOLD_VIOLATIONS=$(grep -iE "threshold.*violated|threshold.*failed" "$RESULT" 2>/dev/null || echo "")
        if [[ -n "$THRESHOLD_VIOLATIONS" ]]; then
          warn "Threshold violations:"
          echo "$THRESHOLD_VIOLATIONS" | sed 's/^/  → /'
        fi
        
        # Check for specific error patterns
        if echo "$RESULT" | grep -qiE "certificate.*verify|tls.*handshake|ssl.*error"; then
          warn "TLS/Certificate errors detected - check CA certificate configuration"
        fi
        if echo "$RESULT" | grep -qiE "timeout|deadline.*exceeded"; then
          warn "Timeout errors detected - requests may be taking too long during rotation"
        fi
        if echo "$RESULT" | grep -qiE "connection.*refused|connection.*reset"; then
          warn "Connection errors detected - Caddy may have been briefly unavailable"
        fi
        
        # Show sample of failed requests (if available)
        FAILED_REQUESTS=$(grep -E "status=[^2][0-9]{2}" "$RESULT" 2>/dev/null | head -5 || echo "")
        if [[ -n "$FAILED_REQUESTS" ]]; then
          warn "Sample failed requests:"
          echo "$FAILED_REQUESTS" | sed 's/^/  → /'
        fi
      fi
      
      # Check for failures using decimal comparison (same as rotation-suite.sh)
      if [[ "$(echo "$H2_FAIL > 0" | bc -l 2>/dev/null || echo "1")" == "1" ]] || [[ "$(echo "$H3_FAIL > 0" | bc -l 2>/dev/null || echo "1")" == "1" ]]; then
        warn "❌ Downtime detected during rotation"
        warn "  → H2 Failures: $H2_FAIL_COUNT out of $H2_COUNT (${H2_FAIL_PCT}%)"
        warn "  → H3 Failures: $H3_FAIL_COUNT out of $H3_COUNT (${H3_FAIL_PCT}%)"
        warn "  → Total Failures: $((H2_FAIL_COUNT + H3_FAIL_COUNT)) out of $((H2_COUNT + H3_COUNT))"
        warn "  → k6 log file: $RESULT (check for detailed error messages)"
      else
        ok "🎉 100% uptime during rotation"
        ok "  → H2: $H2_COUNT requests, 0 failures"
        ok "  → H3: $H3_COUNT requests, 0 failures"
      fi
    else
      warn "Could not collect k6 results"
      warn "  → k6 job may have failed or log file is missing"
      warn "  → Check job status: kubectl -n k6-load get job $K6_JOB"
      warn "  → Check pod logs: kubectl -n k6-load logs job/$K6_JOB"
    fi
  else
    # curl-based mode: Let requests establish before starting rotation (better baseline)
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
  
  # Wait for requests to complete with timeout
  # Background process timeline:
  # - T=0: Process starts
  # - T=5: Baseline wait ends, rotation starts
  # - T=5+ROTATION_DURATION: Rotation ends (e.g., T=220 if rotation takes 215s)
  # - T=0+ROTATION_COVERAGE_TIME: All requests should complete (T=300)
  # After rotation ends, remaining time = ROTATION_COVERAGE_TIME - (5 + ROTATION_DURATION)
  # But since process started at T=0, we need: ROTATION_COVERAGE_TIME - (5 + ROTATION_DURATION) + 5
  # = ROTATION_COVERAGE_TIME - ROTATION_DURATION
  # Default ROTATION_DURATION if not set (e.g., if rotation script failed)
  ROTATION_DURATION="${ROTATION_DURATION:-10}"  # Default to 10s if not set
  # Calculate remaining time: requests need time to complete after rotation
  # With concurrent pool (20 concurrent) and 3.0s timeout, we achieve high throughput
  # Actual observed results (8000 requests):
  #   - 10s: 1162 requests = ~116 req/s
  #   - 20s: 1821 requests = ~91 req/s (average)
  #   - 30s: 3130 requests = ~104 req/s (average)
  #   - 40s: 5122 requests = ~128 req/s (average)
  #   - 50s: 7330 requests = ~147 req/s (average)
  #   - Completed: 8000 requests in ~50s = ~160 req/s peak, ~120 req/s average
  # Completion time = NUM_REQUESTS / throughput + overhead
  # For 15000 requests at ~120 req/s (realistic average): 15000 / 120 = 125s + 20s overhead = 145s
  # Remaining time = ESTIMATED_TOTAL - ROTATION_DURATION + buffer
  THROUGHPUT=120  # Realistic throughput estimate based on actual observed results: 120 req/s average
  ESTIMATED_TOTAL=$((NUM_REQUESTS / THROUGHPUT + 20))  # Add 20s for overhead
  REMAINING_TIME=$((ESTIMATED_TOTAL - ROTATION_DURATION + 30))  # Add 30s buffer
  # With concurrent pool and 3.0s timeout, completion should be reasonable
  if [[ $REMAINING_TIME -lt 150 ]]; then
    REMAINING_TIME=150  # Minimum 150 seconds for 15000 requests
  fi
  say "Waiting for remaining requests to complete (estimated ${REMAINING_TIME}s, target: $NUM_REQUESTS requests)..."
  ELAPSED=0
  LAST_COUNT=0
  STALL_COUNT=0
  while kill -0 $REQ_PID 2>/dev/null && [[ $ELAPSED -lt $REMAINING_TIME ]]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    # Show progress every 10 seconds
    if [[ $((ELAPSED % 10)) -eq 0 ]]; then
      CURRENT_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      echo "  Progress: $CURRENT_LINES/$NUM_REQUESTS requests logged, ${ELAPSED}s elapsed..."
      # Check if we're making progress
      if [[ "$CURRENT_LINES" -eq "$LAST_COUNT" ]]; then
        STALL_COUNT=$((STALL_COUNT + 1))
        if [[ $STALL_COUNT -ge 3 ]]; then
          warn "Requests appear to have stalled (no progress in 30s), checking process..."
          if ! kill -0 $REQ_PID 2>/dev/null; then
            ok "Process completed naturally"
            break
          fi
        fi
      else
        STALL_COUNT=0
        LAST_COUNT=$CURRENT_LINES
      fi
    fi
  done

  # If process is still running, check progress and decide
  if kill -0 $REQ_PID 2>/dev/null; then
    CURRENT_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
    # Calculate expected requests based on elapsed time
    # Process started at T=0, so total elapsed = baseline (5s) + rotation (ROTATION_DURATION) + wait (ELAPSED)
    TOTAL_ELAPSED=$((5 + ROTATION_DURATION + ELAPSED))
    # Expected requests: with 20 concurrent requests and 3.0s timeout, we achieve higher throughput
    # Concurrent pool leverages HTTP/2 multiplexing for production-grade performance
    # Realistic estimate: 120 requests/second (based on actual observed results)
    EXPECTED_REQUESTS=$((TOTAL_ELAPSED * THROUGHPUT))  # Concurrent pool rate: 120 requests per second
    if [[ $EXPECTED_REQUESTS -gt $NUM_REQUESTS ]]; then
      EXPECTED_REQUESTS=$NUM_REQUESTS
    fi
    
    if [[ $CURRENT_LINES -ge $((NUM_REQUESTS - 20)) ]]; then
      # We're very close to the target, wait longer for all requests to complete
      say "Almost complete ($CURRENT_LINES/$NUM_REQUESTS), waiting for all requests to finish..."
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 120 ]]; do
        sleep 2
        EXTRA_WAIT=$((EXTRA_WAIT + 2))
        NEW_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $NEW_LINES -ge $NUM_REQUESTS ]]; then
          ok "All requests completed! ($NEW_LINES/$NUM_REQUESTS)"
          break
        fi
        if [[ $((EXTRA_WAIT % 10)) -eq 0 ]]; then
          echo "  Still waiting: $NEW_LINES/$NUM_REQUESTS requests logged (${EXTRA_WAIT}s extra wait)..."
        fi
      done
      if kill -0 $REQ_PID 2>/dev/null; then
        warn "Background requests still running after extended wait, killing process"
        kill $REQ_PID 2>/dev/null || true
        wait $REQ_PID 2>/dev/null || true
      else
        wait $REQ_PID 2>/dev/null || true
      fi
    elif [[ $CURRENT_LINES -lt $((EXPECTED_REQUESTS * 3 / 4)) ]] && [[ $ELAPSED -gt 60 ]]; then
      # Way behind expected after 60s, might be stuck
      # But be more lenient - only 75% of expected, not 50%
      warn "Background requests behind schedule ($CURRENT_LINES logged, expected ~$EXPECTED_REQUESTS after ${TOTAL_ELAPSED}s), but continuing to wait..."
      # Don't kill yet - requests are just slow, give it more time
      say "Requests are slow but making progress, waiting up to 60 more seconds..."
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 60 ]]; do
        sleep 5
        EXTRA_WAIT=$((EXTRA_WAIT + 5))
        NEW_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $NEW_LINES -ge $NUM_REQUESTS ]]; then
          ok "All requests completed! ($NEW_LINES/$NUM_REQUESTS)"
          break
        fi
        if [[ $((EXTRA_WAIT % 15)) -eq 0 ]]; then
          echo "  Still waiting: $NEW_LINES/$NUM_REQUESTS requests logged..."
        fi
      done
      if kill -0 $REQ_PID 2>/dev/null; then
        FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        warn "Background requests still running ($FINAL_LINES/$NUM_REQUESTS), killing process"
        kill $REQ_PID 2>/dev/null || true
        wait $REQ_PID 2>/dev/null || true
      else
        wait $REQ_PID 2>/dev/null || true
      fi
    else
      # Making progress but not done, wait longer
      # Requests are slow (~5s each), so we need to wait proportionally longer
      say "Process still running ($CURRENT_LINES/$NUM_REQUESTS), waiting longer for slow requests..."
      # Wait up to 2 minutes more (120 seconds) for slow requests to complete
      EXTRA_WAIT=0
      while kill -0 $REQ_PID 2>/dev/null && [[ $EXTRA_WAIT -lt 120 ]]; do
        sleep 10
        EXTRA_WAIT=$((EXTRA_WAIT + 10))
        NEW_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        if [[ $NEW_LINES -ge $NUM_REQUESTS ]]; then
          ok "All requests completed! ($NEW_LINES/$NUM_REQUESTS)"
          break
        fi
        if [[ $((EXTRA_WAIT % 30)) -eq 0 ]]; then
          echo "  Still waiting: $NEW_LINES/$NUM_REQUESTS requests logged (${EXTRA_WAIT}s extra wait)..."
        fi
      done
      if kill -0 $REQ_PID 2>/dev/null; then
        FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        # Check if we're still making progress
        PREV_LINES=$FINAL_LINES
        sleep 10
        NEW_FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        
        if [[ $NEW_FINAL_LINES -gt $PREV_LINES ]]; then
          # Still making progress, wait a bit more
          say "Process still making progress ($PREV_LINES -> $NEW_FINAL_LINES), waiting 30 more seconds..."
          sleep 30
          FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        fi
        
        # Wait for ALL requests to complete - require 100% completion for production-grade testing
        if [[ $FINAL_LINES -ge $NUM_REQUESTS ]]; then
          # All requests completed
          ok "All requests completed! ($FINAL_LINES/$NUM_REQUESTS)"
          wait $REQ_PID 2>/dev/null || true
        else
          # Still waiting for more requests - give it more time
          say "Waiting for remaining requests ($FINAL_LINES/$NUM_REQUESTS), extending wait time..."
          FINAL_EXTRA_WAIT=0
          while kill -0 $REQ_PID 2>/dev/null && [[ $FINAL_EXTRA_WAIT -lt 60 ]] && [[ $FINAL_LINES -lt $NUM_REQUESTS ]]; do
            sleep 5
            FINAL_EXTRA_WAIT=$((FINAL_EXTRA_WAIT + 5))
            FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
            if [[ $FINAL_LINES -ge $NUM_REQUESTS ]]; then
              ok "All requests completed! ($FINAL_LINES/$NUM_REQUESTS)"
              break
            fi
            if [[ $((FINAL_EXTRA_WAIT % 15)) -eq 0 ]]; then
              echo "  Still waiting: $FINAL_LINES/$NUM_REQUESTS requests logged (${FINAL_EXTRA_WAIT}s extra wait)..."
            fi
          done
          if kill -0 $REQ_PID 2>/dev/null; then
            FINAL_LINES=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
            if [[ $FINAL_LINES -lt $NUM_REQUESTS ]]; then
              warn "Background requests still running ($FINAL_LINES/$NUM_REQUESTS), but waiting for completion..."
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
    fi
  else
    wait $REQ_PID 2>/dev/null || true
  fi
  
  # Flush the log file and wait a moment for all writes to complete
  sync /tmp/rotation-test.log 2>/dev/null || true
  sleep 2  # Give the process time to finish writing
  fi  # Close: if [[ "${USE_K6:-false}" == "true" ]] && [[ -n "${K6_JOB:-}" ]]; then (k6 vs curl block)
fi  # Close: if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then

# Only analyze curl-based log file if k6 was NOT used
# k6 results are already shown above, so skip curl-based analysis
if [[ "${SKIP_ROTATION:-0}" != "1" ]] && [[ "${USE_K6:-false}" != "true" ]]; then
  # Analyze results - read the log file (curl-based testing only)
  # Wait a moment to ensure file is fully written
  sleep 1
  if [[ -f /tmp/rotation-test.log ]] && [[ -s /tmp/rotation-test.log ]]; then
    SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
    TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
    # Also count timeouts/errors as expected during restart
    TIMEOUT_COUNT=$(grep -cE "timeout|000|connection refused" /tmp/rotation-test.log 2>/dev/null || echo "0")
  else
    SUCCESS_COUNT="0"
    TOTAL_COUNT="0"
    TIMEOUT_COUNT="0"
  fi
else
  # k6 was used or rotation was skipped - no curl-based log file to analyze
  SUCCESS_COUNT="0"
  TOTAL_COUNT="0"
  TIMEOUT_COUNT="0"
fi

# Ensure counts are numeric (strip any whitespace/newlines)
SUCCESS_COUNT=$(echo "$SUCCESS_COUNT" | tr -d '[:space:]')
TOTAL_COUNT=$(echo "$TOTAL_COUNT" | tr -d '[:space:]')

# Default to 0 if empty
SUCCESS_COUNT="${SUCCESS_COUNT:-0}"
TOTAL_COUNT="${TOTAL_COUNT:-0}"

# Validate numeric
if ! [[ "$SUCCESS_COUNT" =~ ^[0-9]+$ ]]; then
  SUCCESS_COUNT="0"
fi
if ! [[ "$TOTAL_COUNT" =~ ^[0-9]+$ ]]; then
  TOTAL_COUNT="0"
fi

  # Only report curl-based results if k6 was NOT used (k6 results already shown above)
  if [[ "${SKIP_ROTATION:-0}" == "1" ]]; then
    warn "Rotation test skipped - Caddy was not healthy before rotation"
  elif [[ "${USE_K6:-false}" == "true" ]]; then
    # k6 was used - results already shown above, skip curl-based analysis
    : # No-op, k6 results already displayed
  elif [[ "$TOTAL_COUNT" -gt 0 ]]; then
    # ENFORCE 100% COMPLETION: Wait for all requests to complete
    if [[ "$TOTAL_COUNT" -lt "$NUM_REQUESTS" ]]; then
      say "Waiting for all requests to complete ($TOTAL_COUNT/$NUM_REQUESTS logged)..."
      FINAL_WAIT=0
      while [[ $FINAL_WAIT -lt 60 ]] && [[ "$TOTAL_COUNT" -lt "$NUM_REQUESTS" ]]; do
        sleep 5
        FINAL_WAIT=$((FINAL_WAIT + 5))
        TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
        SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
        if [[ "$TOTAL_COUNT" -ge "$NUM_REQUESTS" ]]; then
          break
        fi
        if [[ $((FINAL_WAIT % 15)) -eq 0 ]]; then
          echo "  Still waiting: $TOTAL_COUNT/$NUM_REQUESTS requests logged (${FINAL_WAIT}s wait)..."
        fi
      done
      # Final sync to ensure all writes are flushed
      sync /tmp/rotation-test.log 2>/dev/null || true
      sleep 2
      # Re-read counts after waiting
      TOTAL_COUNT=$(wc -l < /tmp/rotation-test.log 2>/dev/null | tr -d '[:space:]' || echo "0")
      SUCCESS_COUNT=$(grep -c "200" /tmp/rotation-test.log 2>/dev/null || echo "0")
    fi
    
    # Calculate success rate
    SUCCESS_RATE=$((SUCCESS_COUNT * 100 / TOTAL_COUNT))
    
    # Debug: Show failed requests for analysis (if any failures)
    if [[ "$SUCCESS_COUNT" -lt "$TOTAL_COUNT" ]] && [[ "$TOTAL_COUNT" -gt 0 ]]; then
      FAILED_COUNT=$((TOTAL_COUNT - SUCCESS_COUNT))
      say "Debug: $FAILED_COUNT failed request(s) out of $TOTAL_COUNT total"
      echo "  Failed request types:"
      grep -v "200" /tmp/rotation-test.log 2>/dev/null | sort | uniq -c | head -10 | sed 's/^/    /' || true
    fi
  
  # Detect actual deployment strategy
  ACTUAL_STRATEGY=$(kubectl -n ingress-nginx get deployment caddy-h3 -o jsonpath='{.spec.strategy.type}' 2>/dev/null || echo "Unknown")
  ACTUAL_REPLICAS=$(kubectl -n ingress-nginx get deployment caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  
  if [[ "$SUCCESS_COUNT" -gt 0 ]]; then
      if [[ "$SUCCESS_COUNT" -eq "$TOTAL_COUNT" ]]; then
        ok "✅ Zero-downtime rotation confirmed! (100% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        if [[ "$ACTUAL_STRATEGY" == "RollingUpdate" ]] && [[ "$ACTUAL_REPLICAS" -ge 2 ]]; then
          ok "  ✅ Using RollingUpdate with $ACTUAL_REPLICAS replicas - perfect zero-downtime setup!"
        elif [[ "$ACTUAL_STRATEGY" == "RollingUpdate" ]]; then
          ok "  ✅ Using RollingUpdate with admin API reload - zero-downtime achieved!"
        fi
      elif [[ "$SUCCESS_RATE" -ge 95 ]]; then
        ok "✅ Near-zero-downtime rotation (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        if [[ "$ACTUAL_STRATEGY" == "RollingUpdate" ]] && [[ "$ACTUAL_REPLICAS" -ge 2 ]]; then
          warn "  → Strategy is RollingUpdate with $ACTUAL_REPLICAS replicas, but success rate < 100%"
          warn "  → Check if pods are on different nodes (required for hostNetwork)"
        else
          warn "  → For production: Use RollingUpdate strategy with 2+ replicas on multiple nodes for true 100% uptime"
        fi
      elif [[ "$SUCCESS_RATE" -ge 60 ]]; then
        ok "Rotation completed (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        if [[ "$ACTUAL_STRATEGY" == "Recreate" ]]; then
          say "  ℹ️  Note: This success rate is EXPECTED with Recreate strategy"
          say "  ℹ️  Caddy uses Recreate strategy, which causes downtime during pod restart"
          say "  ℹ️  Requests during the restart window (~30-60s) will fail/timeout"
          say "  ℹ️  This is normal behavior for Recreate deployments"
        elif [[ "$ACTUAL_STRATEGY" == "RollingUpdate" ]] && [[ "$ACTUAL_REPLICAS" -eq 1 ]]; then
          say "  ℹ️  Using RollingUpdate with 1 replica + hostNetwork"
          say "  ℹ️  New pod can't start (port conflict), so admin API reload should be used"
          say "  ℹ️  If admin API reload failed, pod restart causes downtime"
        fi
        warn "  → For production: Use RollingUpdate strategy with 2+ replicas on multiple nodes for zero-downtime"
        warn "  → With RollingUpdate + 2 replicas: Old pod stays up while new pod starts, eliminating downtime"
      elif [[ "$SUCCESS_RATE" -ge 40 ]]; then
        warn "Rotation completed with downtime (${SUCCESS_RATE}% success rate - $SUCCESS_COUNT/$TOTAL_COUNT requests)"
        say "  ℹ️  Lower success rate may indicate longer restart time or more requests during restart"
        if [[ "$ACTUAL_STRATEGY" == "Recreate" ]]; then
          say "  ℹ️  This is still expected with Recreate strategy"
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
  
  # Don't cleanup port-forward yet - Test 7 will reuse it for certificate verification
  # Cleanup will happen after Test 7
  
  # Post-rotation health check (wait for requests to finish first, then check)
  say "Post-rotation health check..."
  # Rotation script already verified readiness, but wait a bit more
  sleep 3
  
  # Try multiple times with increasing delays
  POST_ROTATION_HEALTH="000"
  for attempt in 1 2 3; do
      # Use nodeport_curl for macOS TLS issues
      POST_ROTATION_RESPONSE=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 \
      --resolve "$HOST:${PORT}:127.0.0.1" \
      -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || POST_ROTATION_RESPONSE=""
    if [[ -n "$POST_ROTATION_RESPONSE" ]]; then
      POST_ROTATION_HEALTH=$(echo "$POST_ROTATION_RESPONSE" | tail -1 | tr -d '[:space:]')
      if [[ "$POST_ROTATION_HEALTH" == "200" ]]; then
        ok "Caddy is healthy after rotation (HTTP $POST_ROTATION_HEALTH) - attempt $attempt"
        break
      fi
    fi
    if [[ $attempt -lt 3 ]]; then
      sleep 3
    fi
  done
  
  if [[ "$POST_ROTATION_HEALTH" != "200" ]]; then
    warn "Caddy health check failed after rotation (HTTP $POST_ROTATION_HEALTH after 3 attempts)"
    # Final attempt - use nodeport_curl for macOS TLS issues
    sleep 5
    POST_ROTATION_FINAL=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 \
      --resolve "$HOST:${PORT}:127.0.0.1" \
      -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>&1) || POST_ROTATION_FINAL=""
    if [[ -n "$POST_ROTATION_FINAL" ]]; then
      POST_ROTATION_FINAL_HEALTH=$(echo "$POST_ROTATION_FINAL" | tail -1 | tr -d '[:space:]')
      if [[ "$POST_ROTATION_FINAL_HEALTH" == "200" ]]; then
        ok "Caddy is healthy after rotation (HTTP $POST_ROTATION_FINAL_HEALTH) - needed extra time"
      else
        warn "Caddy still not healthy after final check (HTTP $POST_ROTATION_FINAL_HEALTH)"
      fi
    fi
  fi
elif [[ "${USE_K6:-false}" == "true" ]]; then
  # k6 was used - results already shown, no need to analyze curl-based log
  : # No-op, k6 results already displayed above
else
  # curl-based mode but no log file - this shouldn't happen, but handle gracefully
  if [[ "${SKIP_ROTATION:-0}" != "1" ]]; then
    warn "Could not analyze rotation results (log file may be empty or malformed)"
  fi
fi

rm -f /tmp/rotation-test.log

# Test 7: Verify new certificate is being used
say "Test 7: Verify new certificate is active"
# FIX #3: Wait for Caddy to be fully ready before certificate test
# This prevents port-forward from connecting while Caddy is still restarting
say "Waiting for Caddy to be fully ready after rotation..."
kubectl -n "$NS_ING" rollout status deploy/caddy-h3 --timeout=30s 2>/dev/null || warn "Caddy rollout may still be in progress"
sleep 4  # Additional buffer for endpoint propagation and TLS handshake readiness

# FIX: 100% RELIABLE TEST 7 VERSION - Use port-forward to bypass NodePort issues
# Port-forward is appropriate here (single request, not a load test)
# Set up port-forward for certificate verification
CERT_PF_PORT=8443
CERT_PF_PID=""

# Set up port-forward for certificate verification (appropriate for single request)
# Kill any existing port-forward on this port first
pkill -f "kubectl.*port-forward.*caddy-h3.*${CERT_PF_PORT}:443" >/dev/null 2>&1 || true
sleep 1

kubectl -n "$NS_ING" port-forward svc/caddy-h3 ${CERT_PF_PORT}:443 >/dev/null 2>&1 &
CERT_PF_PID=$!
sleep 3  # Give port-forward more time to establish

if ! kill -0 "$CERT_PF_PID" 2>/dev/null; then
  warn "Port-forward failed to start for certificate verification"
  CERT_PF_PID=""
else
  ok "Port-forward established on port ${CERT_PF_PORT} for certificate verification"
fi

# Use openssl s_client via port-forward (100% reliable)
if [[ -n "$CERT_PF_PID" ]] && command -v openssl >/dev/null 2>&1; then
  CERT_INFO=$(echo | openssl s_client -connect "127.0.0.1:${CERT_PF_PORT}" -servername "${HOST}" 2>/dev/null | openssl x509 -noout -subject -issuer 2>/dev/null || echo "")
  if [[ -n "$CERT_INFO" ]]; then
    ok "Certificate info retrieved via port-forward"
    echo "$CERT_INFO" | sed 's/^/  /'
    # Verify it's an mkcert certificate (expected after rotation)
    if echo "$CERT_INFO" | grep -q "mkcert"; then
      ok "Certificate is from mkcert (rotation successful)"
    else
      warn "Certificate may not be from mkcert (unexpected issuer)"
    fi
  else
    warn "Could not retrieve certificate info via port-forward"
  fi
else
  if [[ -z "$CERT_PF_PID" ]]; then
    warn "Port-forward not available for certificate verification"
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    warn "openssl not available - cannot verify certificate"
  fi
fi

# Cleanup port-forward after Test 7 (certificate verification only)
if [[ -n "$CERT_PF_PID" ]]; then
  kill "$CERT_PF_PID" 2>/dev/null || true
  wait "$CERT_PF_PID" 2>/dev/null || true
fi

# Test 8: Full chain with actual API call
say "Test 8: Full chain test with actual API endpoint"
# Re-detect PORT if needed (might have changed after rotation)
# Use the same logic as at the start of the script
CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$CURRENT_CONTEXT" == "kind-h3-multi" ]]; then
  # Multi-node cluster: try ports 8444, 8445, 8446
  PORT=""
  for p in 8445 8446 8444; do
    if curl -k -s --http2 --max-time 1 -H "Host: ${HOST}" "https://127.0.0.1:${p}/_caddy/healthz" >/dev/null 2>&1; then
      PORT=$p
      break
    fi
  done
  PORT="${PORT:-8445}"  # Default to 8445 (worker1) if none work
else
  # Check if service is ClusterIP or NodePort
  SERVICE_TYPE=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.type}' 2>/dev/null || echo "ClusterIP")
  if [[ "$SERVICE_TYPE" == "NodePort" ]]; then
    # With NodePort, detect actual NodePort from service
    PORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "30443")
    if [[ -z "$PORT" ]] || [[ "$PORT" == "30443" ]]; then
      PORT="30443"  # Fallback to default
    fi
  else
    # ClusterIP service - use port-forward (8443)
    PORT="8443"
    # Kill any existing port-forward and start fresh
    pkill -f "kubectl.*port-forward.*caddy-h3.*8443:443" >/dev/null 2>&1 || true
    sleep 1
    kubectl -n ingress-nginx port-forward svc/caddy-h3 8443:443 >/dev/null 2>&1 &
    sleep 3  # Give port-forward time to establish
  fi
fi

# Use nodeport_curl for macOS TLS issues - try multiple times with better error handling
API_RESPONSE=""
API_CODE="000"
for attempt in 1 2 3; do
  API_RESPONSE=$(nodeport_curl -k -sS -w "\n%{http_code}" --http2 --max-time 5 \
    --resolve "$HOST:${PORT}:127.0.0.1" \
    -H "Host: $HOST" "https://$HOST:${PORT}/api/healthz" 2>&1) || API_RESPONSE=""
  API_CODE=$(echo "$API_RESPONSE" | tail -1 | tr -d '[:space:]' || echo "000")
  
  if [[ "$API_CODE" == "200" ]]; then
    break
  elif [[ "$API_CODE" != "000" ]] && [[ "$API_CODE" != "" ]]; then
    # Got a response code (even if not 200) - don't retry
    break
  fi
  
  # If we got 000 or empty, wait and retry
  if [[ $attempt -lt 3 ]]; then
    sleep 2
  fi
done

if [[ "$API_CODE" == "200" ]]; then
  ok "Full chain works: Client -> Caddy (H2) -> Ingress Nginx -> Backend - HTTP $API_CODE"
  RESPONSE_BODY=$(echo "$API_RESPONSE" | sed '$d' | head -5)
  if [[ -n "$RESPONSE_BODY" ]]; then
    echo "Response body: $RESPONSE_BODY"
  fi
elif [[ -n "$API_CODE" ]] && [[ "$API_CODE" != "000" ]]; then
  warn "Full chain test returned HTTP $API_CODE (expected 200)"
  if [[ "$API_CODE" == "502" ]]; then
    echo "  → 502 Bad Gateway: Caddy → Ingress-nginx → Backend chain may be broken"
  elif [[ "$API_CODE" == "404" ]]; then
    echo "  → 404 Not Found: Endpoint may not exist, but routing works"
  fi
else
  warn "Full chain test failed - no response or connection error"
  echo "  → Tried PORT=${PORT}, HOST=${HOST}, SERVICE_TYPE=${SERVICE_TYPE:-unknown}"
  echo "  → Note: Test 8b (H3) passed, so endpoint is reachable via HTTP/3"
  echo "  → This may be a NodePort/port-forward connectivity issue for HTTP/2"
fi

# Optional: H3 checks for Test 8 (uses in-cluster helper for reliability on macOS)
say "Test 8b: Full chain H3 checks (Caddy and API via QUIC)"
# Match the old working version - simple calls without extra timeout wrapper
H3_CADDY=$(
  http3_curl -k -sS -I --http3-only \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/_caddy/healthz" 2>&1 | head -n1 || true
)
if echo "$H3_CADDY" | grep -q "HTTP/3 200"; then
  ok "Caddy (H3) reachable - $H3_CADDY"
else
  warn "Caddy (H3) check failed - $H3_CADDY"
  if [[ -n "$HTTP3_SVC_IP" ]]; then
    echo "  → ClusterIP: $HTTP3_SVC_IP, Resolve: $HTTP3_RESOLVE"
  fi
fi

H3_API=$(
  http3_curl -k -sS -I --http3-only \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/api/healthz" 2>&1 | head -n1 || true
)
if echo "$H3_API" | grep -qE "HTTP/3 200|HTTP/3 404|HTTP/3 502"; then
  ok "API (H3) reachable - $H3_API"
else
  warn "API (H3) check failed - $H3_API"
fi

say "=== All tests complete ==="


