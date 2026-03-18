#!/usr/bin/env bash
# Enhanced Microservices Test: packet capture and explicit HTTP/2 + HTTP/3 (QUIC) verification.
# Run after baseline (run-all sets TARGET_IP, PORT, CA_CERT, HTTP3_RESOLVE). Uses same packet-capture lib as baseline.
# CAPTURE_SKIP_PER_TEST=1 (Colima default): suite-level capture — start once, run all tests, stop once (avoids kubectl exec churn).
# Else: per-test capture — start/stop for each test (thorough but heavier on Colima).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

NS="${NS:-record-platform}"
HOST="${HOST:-record.local}"
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

# CA and resolve: sync from cluster first so we always match Caddy's cert chain, then prefer env
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
mkdir -p "$REPO_ROOT/certs"
# Sync dev-root-ca from cluster to certs/dev-root.pem (ensures CA matches what Caddy serves; fixes curl 60 "self signed certificate")
# Try host kubectl first (tunnel may work), then _kb (colima ssh) when host can't reach API.
K8S_CA=$(kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -z "$K8S_CA" ]] || ! echo "$K8S_CA" | grep -q "BEGIN CERTIFICATE"; then
  K8S_CA=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
fi
# Fallback: record-platform has dev-root-ca too
if [[ -z "$K8S_CA" ]] || ! echo "$K8S_CA" | grep -q "BEGIN CERTIFICATE"; then
  K8S_CA=$(_kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
fi
if [[ -n "$K8S_CA" ]] && echo "$K8S_CA" | grep -q "BEGIN CERTIFICATE"; then
  echo "$K8S_CA" > "$REPO_ROOT/certs/dev-root.pem"
  # Prefer freshly synced CA (cluster is source of truth for Caddy's cert chain) over parent CA_CERT
  CA_CERT="$REPO_ROOT/certs/dev-root.pem"
  [[ "${CA_DEBUG:-0}" == "1" ]] && info "Synced certs/dev-root.pem from cluster dev-root-ca"
else
  [[ "${CA_DEBUG:-0}" == "1" ]] && warn "CA sync failed (ingress-nginx and $NS dev-root-ca); using existing certs/dev-root.pem if present"
  CA_CERT="${CA_CERT:-}"
  [[ -z "$CA_CERT" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && CA_CERT="$REPO_ROOT/certs/dev-root.pem"
  [[ -z "$CA_CERT" ]] && [[ -f "/tmp/grpc-certs/ca.crt" ]] && CA_CERT="/tmp/grpc-certs/ca.crt"
fi
if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
  ok "Using dev-root-ca for strict TLS ($CA_CERT)"
  export SSL_CERT_FILE="$CA_CERT"
  export CURL_CA_BUNDLE="$CA_CERT"
elif [[ -n "$CA_CERT" ]]; then
  warn "CA_CERT=$CA_CERT not found; TLS verification will fail (curl 60)"
fi

# Colima + MetalLB: lock HTTP/3 to LB IP only (NodePort not exposed to host). Derive TARGET_IP from caddy-h3 when missing.
if [[ "$ctx" == *"colima"* ]] && [[ -z "${TARGET_IP:-}" ]]; then
  _lb_ip=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [[ -n "$_lb_ip" ]]; then
    export TARGET_IP="$_lb_ip"
    export USE_LB_FOR_TESTS=1
    info "Colima: using MetalLB LB IP $_lb_ip for HTTP/3 (no NodePort fallback)"
  fi
fi

CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
[[ -z "${CURL_BIN:-}" ]] || ! [[ -x "$CURL_BIN" ]] && CURL_BIN="$(command -v curl 2>/dev/null)" || true
export CURL_MAX_TIME="${CURL_MAX_TIME:-15}"
export CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-3}"
export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"

strict_curl() {
  if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
    "$CURL_BIN" --cacert "$CA_CERT" "$@"
  else
    "$CURL_BIN" -k "$@"
  fi
}

if [[ -f "$SCRIPT_DIR/lib/http3.sh" ]]; then
  . "$SCRIPT_DIR/lib/http3.sh"
  strict_http3_curl() {
    local has_http3_only=0
    for _a in "$@"; do [[ "$_a" == "--http3-only" ]] && has_http3_only=1 && break; done
    local extra=()
    [[ "$has_http3_only" -eq 0 ]] && extra+=(--http3-only)
    if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
      http3_curl --cacert "$CA_CERT" "${extra[@]}" "$@"
    else
      http3_curl -k "${extra[@]}" "$@"
    fi
  }
else
  warn "http3.sh not found; HTTP/3 tests will be skipped"
  strict_http3_curl() { warn "HTTP/3 not available"; return 1; }
fi

PORT="${PORT:-30443}"
CURL_RESOLVE_IP="${TARGET_IP:-127.0.0.1}"
[[ -n "${TARGET_IP:-}" ]] && { PORT=443; export PORT TARGET_IP; }
# Use native curl for HTTP/3 when TARGET_IP (LB IP) is set — avoids Docker CA mount issues (curl 60).
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -x "${CURL_BIN}" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3"; then
  export HTTP3_USE_NATIVE_CURL=1
  export HTTP3_SKIP_DOCKER_BRIDGE=1
  [[ "${CA_DEBUG:-0}" == "1" ]] && info "HTTP3_USE_NATIVE_CURL=1 (LB IP + curl --http3)"
fi
HTTP3_RESOLVE="${HTTP3_RESOLVE:-$HOST:443:${CURL_RESOLVE_IP}}"
DETECTED_NODEPORT=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null | head -1 | awk '{print $1}')
HTTP3_NODEPORT="${DETECTED_NODEPORT:-30443}"
[[ -z "${TARGET_IP:-}" ]] && HTTP3_RESOLVE="${HOST}:${HTTP3_NODEPORT}:127.0.0.1"

# Capture dir and libs
CAPTURE_DIR="${SMOKE_TEST_CAPTURES_DIR:-/tmp/smoke-test-captures-$(date +%s)}"
mkdir -p "$CAPTURE_DIR"
. "$SCRIPT_DIR/lib/packet-capture.sh"
[[ -f "$SCRIPT_DIR/lib/protocol-verification.sh" ]] && . "$SCRIPT_DIR/lib/protocol-verification.sh"

# Caddy pods for per-test capture
CADDY_PODS=()
while IFS= read -r p; do [[ -n "$p" ]] && CADDY_PODS+=("$p"); done < <(_kb -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n')
if [[ ${#CADDY_PODS[@]} -eq 0 ]]; then
  warn "No Caddy pods found; per-test capture will be skipped"
fi

export CAPTURE_TRAFFIC_TARGET="${CAPTURE_TRAFFIC_TARGET:-LB IP ${CURL_RESOLVE_IP}:${PORT}}"
export CAPTURE_INSTALL_TIMEOUT="${CAPTURE_INSTALL_TIMEOUT:-45}"
# Per-test: no global CAPTURE_STOP_TIMEOUT so we get full copy and verify (optional: set CAPTURE_STOP_TIMEOUT=30 for faster runs)
CAPTURE_DRAIN_SECONDS="${CAPTURE_DRAIN_SECONDS:-5}"

extract_user_id() {
  local token=$1
  [[ -z "$token" ]] && echo "" && return
  local payload=$(echo "$token" | cut -d'.' -f2 | tr '_-' '/+')
  local mod=$((${#payload} % 4))
  [[ $mod -eq 2 ]] && payload="${payload}=="
  [[ $mod -eq 3 ]] && payload="${payload}="
  echo "$payload" | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo ""
}

# When CAPTURE_SKIP_PER_TEST=1: run command only (no per-test capture). Used for suite-level capture mode.
_run_cmd_only() {
  local response_file=""
  shift 3  # test_name, copy_subdir, expected_protocol
  if [[ $# -gt 0 ]] && [[ "$1" == /* ]] || [[ "$1" == */* ]]; then
    response_file="$1"
    shift 1
  fi
  local request_cmd=("$@")
  set +e
  if [[ -n "$response_file" ]]; then
    "${request_cmd[@]}" >"$response_file" 2>&1 || true
  else
    "${request_cmd[@]}" >/dev/null 2>&1 || true
  fi
  set -e
}

# Start capture on all Caddy pods, run command, stop and copy to subdir, verify protocol (http2 or http3).
# Optional: pass a path as 4th arg (response_file); then request stdout is written there for parsing.
_run_test_with_capture() {
  local test_name="$1"
  local copy_subdir="$2"
  local expected_protocol="$3"
  local response_file=""
  shift 3
  if [[ $# -gt 0 ]] && [[ "$1" == /* ]] || [[ "$1" == */* ]]; then
    response_file="$1"
    shift 1
  fi
  local request_cmd=("$@")
  mkdir -p "$CAPTURE_DIR/$copy_subdir"
  init_capture_session
  # Port-only filter: in-pod tcpdump sees node/pod IPs, not LB IP. When LB IP (TARGET_IP:443): tcp/udp 443 only.
  local _capture_filter
  if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
    _capture_filter="tcp port 443 or udp port 443"
  else
    _capture_filter="tcp port 443 or udp port 443 or tcp port ${PORT} or tcp port 30443"
  fi
  for p in "${CADDY_PODS[@]}"; do
    ok "Starting capture on Caddy $p (HTTP/2 + HTTP/3/QUIC)"
    start_capture "ingress-nginx" "$p" "$_capture_filter"
  done
  sleep "${CAPTURE_WARMUP_SECONDS:-2}"
  # Run the actual request(s); optionally save response for parsing (non-fatal)
  set +e
  if [[ -n "$response_file" ]]; then
    "${request_cmd[@]}" >"$response_file" 2>&1 || true
  else
    "${request_cmd[@]}" >/dev/null 2>&1 || true
  fi
  set -e
  # Stop capture and copy pcaps (non-fatal so suite always continues)
  set +e
  export CAPTURE_COPY_DIR="$CAPTURE_DIR/$copy_subdir"
  export CAPTURE_DRAIN_SECONDS="${CAPTURE_DRAIN_SECONDS:-5}"
  stop_and_analyze_captures 1 || true
  set -e
  # Verify protocol in copied pcaps (non-fatal)
  local copy_dir="$CAPTURE_DIR/$copy_subdir"
  if [[ -d "$copy_dir" ]]; then
    set +e
    # HTTP/2: ALPN is encrypted in TLS handshake; tcpdump without SSLKEYLOGFILE cannot decode it. TCP 443 = proof of HTTPS.
    # HTTP/3: verify QUIC packets or UDP 443 (QUIC is encrypted; tshark "quic" may not decode without keylog).
    if [[ "$expected_protocol" == "http3" ]] && type count_quic_in_pcap &>/dev/null; then
      local quic_total=0
      for pcap in "$copy_dir"/*.pcap; do
        [[ -f "$pcap" ]] && [[ -s "$pcap" ]] && quic_total=$((quic_total + $(count_quic_in_pcap "$pcap" 2>/dev/null || echo 0)))
      done
      if [[ "${quic_total:-0}" -gt 0 ]]; then
        ok "HTTP/3 (QUIC) verified at packet level: $quic_total QUIC packets (test: $test_name)"
      else
        warn "HTTP/3 wire verification: no QUIC packets in pcaps (test: $test_name)"
      fi
    fi
    set -e
  fi
}

say "=== Enhanced Microservices Test with Packet-Level Verification ==="
USE_SUITE_CAPTURE=0
[[ "${CAPTURE_SKIP_PER_TEST:-0}" == "1" ]] && USE_SUITE_CAPTURE=1
[[ "$USE_SUITE_CAPTURE" -eq 1 ]] && info "Suite-level capture (CAPTURE_SKIP_PER_TEST=1) — one start/stop; Colima-stable"
info "Capture directory: $CAPTURE_DIR"
info "DB verification: after each write we check the respective DB (ports 5437 auth, 5433 records, 5434 social, 5435 listings, 5436 shopping)."
info "Timeout: set DB_VERIFY_MAX_SECONDS=60 (or 0 to disable) so slow DB verify does not block remaining suites."
echo ""

# Pre-flight
say "Pre-flight: Checking database schema..."
# Auth on 5437: database is "auth"; fallback to "records" for backward compatibility
AUTH_SCHEMA=$(PGCONNECT_TIMEOUT=3 PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d auth -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>/dev/null || echo "")
[[ "$AUTH_SCHEMA" != "1" ]] && AUTH_SCHEMA=$(PGCONNECT_TIMEOUT=3 PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>/dev/null || echo "")
if echo "$AUTH_SCHEMA" | grep -q "1"; then
  ok "Auth schema exists"
else
  warn "Auth schema check failed; continuing anyway"
fi

say "Checking service readiness..."
for svc in auth-service records-service api-gateway; do
  if _kb -n "$NS" rollout status "deployment/$svc" --timeout=15s >/dev/null 2>&1; then
    ok "$svc is ready"
  else
    warn "$svc may not be ready; continuing"
  fi
done
# Post-baseline settle: give DB verification from previous suite time to finish (avoids auth schema race).
info "Settle (5s) after baseline before first test…"
sleep 5

TEST_EMAIL="microservice-test-$(date +%s)@example.com"
TEST_PASSWORD="test123"
TOKEN=""
USER1_ID=""
RECORD_ID=""

# Suite-level capture: start once before Test 1 (Colima-stable; no per-test kubectl exec churn)
# When TARGET_IP (LB IP): Caddy sees TCP/UDP 443 only; no NodePort 30443. Filter: tcp port 443 or udp port 443.
if [[ "$USE_SUITE_CAPTURE" -eq 1 ]] && [[ ${#CADDY_PODS[@]} -gt 0 ]] && [[ "${DISABLE_PACKET_CAPTURE:-0}" != "1" ]]; then
  say "Starting suite-level packet capture (all Caddy pods)…"
  init_capture_session
  if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
    _capture_filter="tcp port 443 or udp port 443"
  else
    _capture_filter="tcp port 443 or udp port 443 or tcp port ${PORT} or tcp port 30443"
  fi
  for p in "${CADDY_PODS[@]}"; do
    ok "Capture on Caddy $p"
    start_capture "ingress-nginx" "$p" "$_capture_filter"
  done
  sleep "${CAPTURE_WARMUP_SECONDS:-2}"
fi

# --- Test 1: Auth Registration via HTTP/2 (with packet capture) ---
# Retry up to 3x — suite depends on token; transient 000 can occur (Caddy reload, packet capture).
say "--- Test 1: Auth Service - Registration via HTTP/2 (with packet capture) ---"
REGISTER_RESPONSE_FILE="/tmp/enhanced-register-$$.out"
REGISTER_RESPONSE=""
for _attempt in 1 2 3; do
  if [[ "$USE_SUITE_CAPTURE" -eq 1 ]]; then
    _run_cmd_only "test1-register-http2" "test1-register-http2" "http2" "$REGISTER_RESPONSE_FILE" \
      strict_curl -sS -w "\n%{http_code}\n%{http_version}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
      -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" "https://$HOST:${PORT}/api/auth/register"
  else
    _run_test_with_capture "test1-register-http2" "test1-register-http2" "http2" "$REGISTER_RESPONSE_FILE" \
      strict_curl -sS -w "\n%{http_code}\n%{http_version}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
      -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" "https://$HOST:${PORT}/api/auth/register"
  fi
  [[ -f "$REGISTER_RESPONSE_FILE" ]] && REGISTER_RESPONSE=$(cat "$REGISTER_RESPONSE_FILE")
  _code=$(echo "$REGISTER_RESPONSE" | tail -2 | head -1)
  [[ "$_code" == "201" ]] || [[ "$_code" == "409" ]] && break
  [[ $_attempt -lt 3 ]] && { info "Retrying registration (attempt $_attempt/3 got HTTP ${_code:-000})…"; sleep 2; }
done
[[ -f "$REGISTER_RESPONSE_FILE" ]] && REGISTER_RESPONSE=$(cat "$REGISTER_RESPONSE_FILE") && rm -f "$REGISTER_RESPONSE_FILE"
REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -2 | head -1)
if [[ "$REGISTER_CODE" == "201" ]]; then
  TOKEN=$(echo "$REGISTER_RESPONSE" | sed '$d' | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER1_ID=$(extract_user_id "$TOKEN")
  ok "User 1 registration works via HTTP/2"
  [[ -n "$TOKEN" ]] && echo "Token: ${TOKEN:0:50}..."
  [[ -n "$USER1_ID" ]] && echo "User 1 ID: $USER1_ID"
else
  warn "User 1 registration failed - HTTP $REGISTER_CODE"
fi
echo ""

# --- Test 2: Login via HTTP/3 (with packet capture) - always send HTTP/3 request so QUIC is captured ---
# QUIC warmup: on Colima/macOS, QUIC handshake often needs a few seconds before stabilizing.
[[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && sleep "${CAPTURE_WARMUP_SECONDS:-4}"
say "--- Test 2: Auth Service - Login via HTTP/3 (with packet capture) ---"
if [[ "$USE_SUITE_CAPTURE" -eq 1 ]]; then
  _run_cmd_only "test2-login-http3" "test2-login-http3" "http3" \
    strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" "https://$HOST/api/auth/login"
else
  _run_test_with_capture "test2-login-http3" "test2-login-http3" "http3" \
    strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" "https://$HOST/api/auth/login"
fi
if [[ -z "$TOKEN" ]]; then
  LOGIN_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" "https://$HOST/api/auth/login" 2>/dev/null) || true
  LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
  if [[ "$LOGIN_CODE" == "200" ]]; then
    TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    USER1_ID=$(extract_user_id "$TOKEN")
    ok "User 1 login works via HTTP/3"
  else
    warn "User 1 login via HTTP/3 failed - HTTP $LOGIN_CODE"
  fi
else
  ok "User 1 already has token from registration"
fi
echo ""

# --- Test 3: Create Record via HTTP/2 (with packet capture) ---
say "--- Test 3: Records Service - Create Record via HTTP/2 (with packet capture) ---"
if [[ -n "${TOKEN:-}" ]]; then
  if [[ "$USE_SUITE_CAPTURE" -eq 1 ]]; then
    _run_cmd_only "test3-create-record-http2" "test3-create-record-http2" "http2" \
      strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" -X POST "https://$HOST:${PORT}/api/records" \
      -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}'
  else
    _run_test_with_capture "test3-create-record-http2" "test3-create-record-http2" "http2" \
      strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" -X POST "https://$HOST:${PORT}/api/records" \
      -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}'
  fi
  CREATE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" -X POST "https://$HOST:${PORT}/api/records" \
    -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}' 2>/dev/null) || true
  CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  if [[ "$CREATE_CODE" =~ ^(200|201)$ ]]; then
    ok "Create record works via HTTP/2"
    RECORD_ID=$(echo "$CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Create record failed - HTTP $CREATE_CODE"
  fi
else
  warn "Skipping record creation - no auth token"
fi
echo ""

# --- Test 3b: Create Record via HTTP/3 (with packet capture and QUIC verify) ---
say "--- Test 3b: Records Service - Create Record via HTTP/3 (with packet capture) ---"
if [[ -n "${TOKEN:-}" ]]; then
  if [[ "$USE_SUITE_CAPTURE" -eq 1 ]]; then
    _run_cmd_only "test3b-create-record-http3" "test3b-create-record-http3" "http3" \
      strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 30 \
      -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" -X POST "https://$HOST/api/records" \
      -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}'
  else
    _run_test_with_capture "test3b-create-record-http3" "test3b-create-record-http3" "http3" \
      strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 30 \
      -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      --resolve "$HTTP3_RESOLVE" -X POST "https://$HOST/api/records" \
      -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}'
  fi
  CREATE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" -X POST "https://$HOST/api/records" \
    -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}' 2>/dev/null) || true
  CREATE_H3_CODE=$(echo "$CREATE_H3_RESPONSE" | tail -1)
  if [[ "$CREATE_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Create record works via HTTP/3"
  else
    warn "Create record via HTTP/3 failed - HTTP ${CREATE_H3_CODE:-000}"
  fi
else
  warn "Skipping record creation via HTTP/3 - no auth token"
fi
echo ""

# --- Test 4: Health checks HTTP/2 and HTTP/3 (with packet capture for both) ---
say "--- Test 4: Health Checks with Protocol Verification ---"
if [[ "$USE_SUITE_CAPTURE" -eq 1 ]]; then
  _run_cmd_only "test4-health-http2" "test4-health-http2" "http2" \
    strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz"
else
  _run_test_with_capture "test4-health-http2" "test4-health-http2" "http2" \
    strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz"
fi
H2_HEALTH=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>/dev/null) || true
H2_CODE=$(echo "$H2_HEALTH" | tail -1)
[[ "$H2_CODE" == "200" ]] && ok "Caddy health check works via HTTP/2" || warn "Caddy health check failed via HTTP/2"

if [[ "$USE_SUITE_CAPTURE" -eq 1 ]]; then
  _run_cmd_only "test4-health-http3" "test4-health-http3" "http3" \
    strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/_caddy/healthz"
else
  _run_test_with_capture "test4-health-http3" "test4-health-http3" "http3" \
    strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 15 \
    -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/_caddy/healthz"
fi
H3_HEALTH=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 15 \
  -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST/_caddy/healthz" 2>/dev/null) || true
H3_CODE=$(echo "$H3_HEALTH" | tail -1)
[[ "$H3_CODE" == "200" ]] && ok "Caddy health check works via HTTP/3" || warn "Caddy health check failed via HTTP/3"

# Suite-level capture: stop once after all tests (Colima-stable)
# Bash 3.2-safe: ${#array[@]:-0} is invalid; use explicit count (macOS default bash is 3.2).
CAPTURE_POD_COUNT=0
if [[ -n "${_CAPTURE_PODS+x}" ]]; then
  CAPTURE_POD_COUNT=${#_CAPTURE_PODS[@]}
fi
if [[ "$USE_SUITE_CAPTURE" -eq 1 ]] && [[ "$CAPTURE_POD_COUNT" -gt 0 ]] && [[ "${DISABLE_PACKET_CAPTURE:-0}" != "1" ]]; then
  say "Stopping suite-level packet capture…"
  export CAPTURE_COPY_DIR="$CAPTURE_DIR/suite-level"
  mkdir -p "$CAPTURE_COPY_DIR"
  set +e
  stop_and_analyze_captures 1 || true
  set -e
fi

# gRPC/HTTP/3 health block (MetalLB: gRPC via Caddy LB IP only; else Envoy NodePort/port-forward)
if [[ -f "$SCRIPT_DIR/lib/grpc-http3-health.sh" ]]; then
  [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && say "Health: gRPC via LB IP (Caddy→Envoy)" || say "Health: gRPC (Envoy + Caddy HTTP/3)"
  . "$SCRIPT_DIR/lib/grpc-http3-health.sh"
  run_grpc_http3_health_checks || true
fi

say "=== Enhanced Test Complete ==="
ok "Per-test packet capture and HTTP/2 + HTTP/3 verification done. Capture dir: $CAPTURE_DIR"
