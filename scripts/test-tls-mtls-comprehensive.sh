#!/usr/bin/env bash
# Comprehensive TLS/mTLS test suite (hardened)
# Tests HTTP/3, gRPC, certificate chains, mTLS configuration; DB & cache verification at end.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

NS="off-campus-housing-tracker"
NS_ING="ingress-nginx"
HOST="${HOST:-off-campus-housing.test}"
PORT="${PORT:-30443}"
ctx=$(kubectl config current-context 2>/dev/null || echo "")

# Preflight: ensure API server reachable (skip if SKIP_PREFLIGHT=1)
if [[ "${SKIP_PREFLIGHT:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  say "Preflight: API server ready"
  KUBECTL_REQUEST_TIMEOUT=10s API_SERVER_MAX_ATTEMPTS=5 API_SERVER_SLEEP=2 \
    ENSURE_CAP=60 PREFLIGHT_CAP=30 "$SCRIPT_DIR/ensure-api-server-ready.sh" 2>/dev/null || warn "Preflight had issues; continuing."
fi

_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

# MetalLB / LB hostname on caddy-h3 — required for strict gRPC/HTTP/3 (no NodePort, no port-forward, no 127.0.0.1).
if [[ -z "${TARGET_IP:-}" ]]; then
  _lb=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  [[ -z "$_lb" ]] && _lb=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
  [[ -n "$_lb" ]] && export TARGET_IP="$_lb"
fi
[[ -n "${TARGET_IP:-}" ]] && export PORT=443
CURL_RESOLVE_IP="${TARGET_IP:-}"

FAILED=0
PASSED=0

test_result() {
  if [[ $1 -eq 0 ]]; then
    PASSED=$((PASSED + 1))
    ok "$2"
  else
    FAILED=$((FAILED + 1))
    fail "$2"
  fi
}

say "=== Comprehensive TLS/mTLS Test Suite ==="

# Get CA certificate (prefer repo certs/dev-root.pem from preflight/rotation)
REPO_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"
CA_CERT=""
[[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && [[ -s "$REPO_ROOT/certs/dev-root.pem" ]] && CA_CERT="$REPO_ROOT/certs/dev-root.pem"
if [[ -z "$CA_CERT" ]] || [[ ! -f "$CA_CERT" ]]; then
  K8S_CA_ING=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA_ING" ]]; then
    CA_CERT="/tmp/test-ca-$$.pem"
    echo "$K8S_CA_ING" > "$CA_CERT"
  fi
fi

# Strict harness: no grpcurl -plaintext. Require trust anchor (repo certs/dev-root.pem or cluster dev-root-ca).
if [[ "${TLS_SUITE_ALLOW_PLAINTEXT_GRPC:-0}" == "1" ]]; then
  warn "TLS_SUITE_ALLOW_PLAINTEXT_GRPC=1 — plaintext gRPC fallbacks allowed (not recommended)"
elif [[ -z "$CA_CERT" ]] || [[ ! -f "$CA_CERT" ]] || [[ ! -s "$CA_CERT" ]]; then
  fail "Strict TLS harness: CA missing. Add certs/dev-root.pem or ensure ingress-nginx/dev-root-ca exists. Run: scripts/ensure-strict-tls-mtls-preflight.sh. Emergency override: TLS_SUITE_ALLOW_PLAINTEXT_GRPC=1"
  exit 1
fi

# mTLS client certs: sync from cluster och-service-tls (or repo leaf) — never rely on missing certs/tls.crt in repo root.
GRPC_CERTS_DIR="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
if [[ -f "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh" ]]; then
  # shellcheck source=scripts/lib/ensure-och-grpc-certs.sh
  source "$SCRIPT_DIR/lib/ensure-och-grpc-certs.sh"
  och_sync_grpc_certs_to_dir "$GRPC_CERTS_DIR" "$NS" || true
fi
MTLS_CERT=""
MTLS_KEY=""
if [[ -f "$GRPC_CERTS_DIR/tls.crt" ]] && [[ -f "$GRPC_CERTS_DIR/tls.key" ]] && [[ -s "$GRPC_CERTS_DIR/tls.crt" ]] && [[ -s "$GRPC_CERTS_DIR/tls.key" ]]; then
  MTLS_CERT="$GRPC_CERTS_DIR/tls.crt"
  MTLS_KEY="$GRPC_CERTS_DIR/tls.key"
  info "mTLS client certs available (gRPC tests will use client auth)"
else
  warn "mTLS client certs missing after sync; gRPC via LB may use TLS-only or fail if Envoy requires client cert"
fi
# Test 1: HTTP/3 Certificate Chain Verification
say "Test 1: HTTP/3 Certificate Chain Verification"
if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
  . "$SCRIPT_DIR/lib/http3.sh"
  if [[ -z "${TARGET_IP:-}" ]]; then
    test_result 1 "HTTP/3 certificate verification: FAILED (TARGET_IP required — set MetalLB IP on caddy-h3 or export TARGET_IP)"
  else
    HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
  HTTP3_TEST=$(http3_curl --cacert "$CA_CERT" -sS -w "\n%{http_code}" --http3-only --max-time 10 \
    -H "Host: $HOST" \
    --resolve "$HTTP3_RESOLVE" \
    "https://$HOST/_caddy/healthz" 2>&1) || HTTP3_RC=$?
  HTTP3_RC=${HTTP3_RC:-0}
  HTTP3_CODE=$(echo "$HTTP3_TEST" | tail -1)
  
  if [[ "$HTTP3_RC" -eq 0 ]] && [[ "$HTTP3_CODE" == "200" ]]; then
    test_result 0 "HTTP/3 certificate verification: PASSED"
  else
    test_result 1 "HTTP/3 certificate verification: FAILED (exit $HTTP3_RC, HTTP $HTTP3_CODE)"
    if [[ "$HTTP3_RC" -eq 77 ]]; then
      info "  This indicates certificate chain issue - CA may not be in chain"
    fi
  fi
  fi
else
  test_result 1 "HTTP/3 test skipped (CA certificate not available)"
fi

# Test 2: gRPC via Caddy → Envoy at MetalLB :443 only (no NodePort, no port-forward, no 127.0.0.1)
say "Test 2: gRPC via Envoy (edge ${TARGET_IP:-?}:443)"
TLS_SUITE_GRPC_EDGE_OK=0
PROTO_DIR=""
RELATIVE_PROTO="${SCRIPT_DIR}/../proto"
if [[ -d "$RELATIVE_PROTO" ]]; then
  PROTO_DIR="$(cd "$RELATIVE_PROTO" && pwd)"
else
  INFRA_PROTO="${SCRIPT_DIR}/../../infra/k8s/base/config/proto"
  if [[ -d "$INFRA_PROTO" ]]; then
    PROTO_DIR="$(cd "$INFRA_PROTO" && pwd)"
  fi
fi

if [[ -n "$PROTO_DIR" ]] && command -v grpcurl >/dev/null 2>&1; then
  GRPC_ENVOY_SUCCESS=0
  grpc_authority="${HOST:-off-campus-housing.test}"
  if [[ -n "${TARGET_IP:-}" ]] && [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    if [[ -n "$MTLS_CERT" ]] && [[ -n "$MTLS_KEY" ]] && [[ -f "$MTLS_CERT" ]] && [[ -f "$MTLS_KEY" ]]; then
      GRPC_TEST=$(grpcurl -cacert "$CA_CERT" -cert "$MTLS_CERT" -key "$MTLS_KEY" -authority "$grpc_authority" -max-time 8 \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/health.proto" -d '{"service":""}' "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || GRPC_RC=$?
    else
      GRPC_TEST=$(grpcurl -cacert "$CA_CERT" -authority "$grpc_authority" -max-time 8 \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/health.proto" -d '{"service":""}' "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || GRPC_RC=$?
    fi
    GRPC_RC=${GRPC_RC:-0}
    if echo "$GRPC_TEST" | grep -q "SERVING"; then
      [[ -n "$MTLS_CERT" ]] && [[ -f "$MTLS_CERT" ]] && test_result 0 "gRPC via LB IP (Caddy→Envoy): PASSED (mTLS)" || test_result 0 "gRPC via LB IP (Caddy→Envoy): PASSED (strict TLS)"
      GRPC_ENVOY_SUCCESS=1
      TLS_SUITE_GRPC_EDGE_OK=1
    fi
  fi
  if [[ $GRPC_ENVOY_SUCCESS -eq 0 ]]; then
    if [[ -n "${TARGET_IP:-}" ]]; then
      test_result 1 "gRPC via LB IP: FAILED (check CA_CERT and ${TARGET_IP}:443 reachability, -authority=$grpc_authority)"
    else
      test_result 1 "gRPC via edge: FAILED (TARGET_IP unset — expose caddy-h3 LoadBalancer or export TARGET_IP)"
    fi
  fi
else
  test_result 1 "gRPC Envoy test skipped (grpcurl or proto directory not found)"
fi

# Test 3: direct pod gRPC — removed; strict suite validates only through edge :443 (Test 2).
say "Test 3: Direct pod gRPC (superseded by edge path)"
if [[ "${TLS_SUITE_GRPC_EDGE_OK:-0}" -eq 1 ]]; then
  test_result 0 "Test 3: N/A — auth health validated via Caddy/Envoy at ${TARGET_IP}:443 (no port-forward)"
elif [[ -n "${TARGET_IP:-}" ]]; then
  test_result 1 "Test 3: Edge gRPC did not pass in Test 2 — not attempting localhost/port-forward"
else
  test_result 1 "Test 3: TARGET_IP required for strict TLS suite"
fi

# Test 4: gRPC Authenticate Method (transport-aware)
# Registers via HTTP/3 when curl supports --http3-only, else HTTP/2. Captures http_version and time_appconnect.
# Env: STRICT_HTTP3=1 fail if not H3; MAX_TLS_HANDSHAKE=0.3 warn if exceeded; TLS_H2_H3_COMPARE=1 run H2 and log delta;
#      PUSH_TLS_METRICS=1 push handshake to Pushgateway; MAX_H2_H3_DELTA=0.15 warn if H3 slower than H2 by more.
# On 409 we login and proceed; at end we delete test user(s) so next run has no 409.
# QUIC packet loss: not parsed here; use packet capture or curl -v when your build exposes loss stats.
say "Test 4: gRPC Authenticate Method"
# Warmup: ensure Caddy and auth path are ready (avoids curl 28 / TCP open but no response when api-gateway or auth-service DB pool is cold)
if [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]] && [[ -n "${CURL_RESOLVE_IP:-}" ]]; then
  curl -sf --connect-timeout 5 --max-time 10 --cacert "$CA_CERT" --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" "https://$HOST:${PORT}/_caddy/healthz" -o /dev/null 2>/dev/null && true
fi
sleep 3

TLS_TEST4_TOKEN=""
if [[ -n "$PROTO_DIR" ]] && command -v grpcurl >/dev/null 2>&1; then
  TEST_EMAIL="test-tls-$(date +%s)-$$@example.com"
  TEST_PASSWORD="test123"
  REG_RC=1
  REG_HTTP_CODE=""
  REGISTER_RESPONSE=""

  # Extended write-out for protocol and handshake (http_version + time_appconnect). Fallback to code-only if last line has one field.
  CURL_WRITE_OUT="\n%{http_code}"
  curl --help all 2>/dev/null | grep -q "http_version" && CURL_WRITE_OUT="\n%{http_code} %{http_version} %{time_appconnect}" || true
  USE_HTTP3_REG=0
  curl --help all 2>/dev/null | grep -q "http3-only" && USE_HTTP3_REG=1 || true

  # Prefer grpcurl for Register (avoids curl timeout when auth route is gRPC or REST is slow). Fallback to curl REST.
  _do_register_grpc() {
    if [[ -n "${TARGET_IP:-}" ]] && [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
      grpcurl -cacert "$CA_CERT" -authority "$HOST" -max-time 10 \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/auth.proto" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
        "${TARGET_IP}:443" auth.AuthService/Register 2>&1
    else
      return 1
    fi
  }
  _do_register() {
    local proto="${1:-}"
    if [[ "$proto" == "h3" ]] && [[ "$USE_HTTP3_REG" -eq 1 ]]; then
      if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
        curl --cacert "$CA_CERT" -sS -w "$CURL_WRITE_OUT" --http3-only --max-time 10 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" -H "Content-Type: application/json" \
          -X POST "https://$HOST:${PORT}/api/auth/register" \
          -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1
      else
        curl -k -sS -w "$CURL_WRITE_OUT" --http3-only --max-time 10 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" -H "Content-Type: application/json" \
          -X POST "https://$HOST:${PORT}/api/auth/register" \
          -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1
      fi
    else
      if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
        curl --cacert "$CA_CERT" -sS -w "$CURL_WRITE_OUT" --http2 --max-time 10 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" -H "Content-Type: application/json" \
          -X POST "https://$HOST:${PORT}/api/auth/register" \
          -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1
      else
        curl -k -sS -w "$CURL_WRITE_OUT" --http2 --max-time 10 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" -H "Content-Type: application/json" \
          -X POST "https://$HOST:${PORT}/api/auth/register" \
          -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1
      fi
    fi
  }

  # Try grpcurl Register first (avoids curl 28 timeout when auth is gRPC or REST path is slow).
  REGISTER_RESPONSE=""
  _grpc_out="/tmp/reg_grpc_$$.out"
  _do_register_grpc > "$_grpc_out" 2>&1 || true
  if grep -q "token" "$_grpc_out" 2>/dev/null; then
    REGISTER_RESPONSE=$(cat "$_grpc_out")
    REG_RC=0
    REG_HTTP_CODE="200"
    REG_OK=true
    TLS_TEST4_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
    rm -f "$_grpc_out"
  else
    rm -f "$_grpc_out"
    REGISTER_RESPONSE=$(_do_register "h3") || REG_RC=$?
  REG_RC=${REG_RC:-0}
  _last_line=$(echo "$REGISTER_RESPONSE" | tail -1)
  REG_HTTP_CODE=$(echo "$_last_line" | awk '{print $1}')
  REG_HTTP_VERSION=$(echo "$_last_line" | awk '{print $2}')
  REG_TLS_HANDSHAKE=$(echo "$_last_line" | awk '{print $3}')
  # If only one field (old curl), handshake might be in $2
  [[ -z "$REG_TLS_HANDSHAKE" ]] && [[ -n "$(echo "$_last_line" | awk '{print $2}')" ]] && [[ "$(echo "$_last_line" | awk '{print $2}')" =~ ^[0-9]+\.?[0-9]*$ ]] && REG_TLS_HANDSHAKE=$(echo "$_last_line" | awk '{print $2}')

  # Retry once on connection/timeout or 5xx (use new email on retry to avoid 409 from partial success)
  if [[ "$REG_RC" -ne 0 ]] || [[ "$REG_HTTP_CODE" =~ ^5[0-9][0-9]$ ]]; then
    sleep 3
    TEST_EMAIL="test-tls-$(date +%s)-$$-r@example.com"
    REGISTER_RESPONSE=$(_do_register "h3") || REG_RC=$?
    REG_RC=${REG_RC:-0}
    _last_line=$(echo "$REGISTER_RESPONSE" | tail -1)
    REG_HTTP_CODE=$(echo "$_last_line" | awk '{print $1}')
    REG_HTTP_VERSION=$(echo "$_last_line" | awk '{print $2}')
    REG_TLS_HANDSHAKE=$(echo "$_last_line" | awk '{print $3}')
    [[ -z "$REG_TLS_HANDSHAKE" ]] && [[ -n "$(echo "$_last_line" | awk '{print $2}')" ]] && [[ "$(echo "$_last_line" | awk '{print $2}')" =~ ^[0-9]+\.?[0-9]*$ ]] && REG_TLS_HANDSHAKE=$(echo "$_last_line" | awk '{print $2}')
  fi

  # Success = HTTP 200/201. Do not require curl exit 0 — curl can exit 1 even on 201 (connection closed after response, H2/H3).
  REG_OK=false
  if [[ "$REG_HTTP_CODE" =~ ^(200|201)$ ]]; then
    REG_OK=true
    TLS_TEST4_TOKEN=$(echo "$REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    # Transport-aware curl exit handling
    if [[ "$REG_RC" -ne 0 ]]; then
      case "$REG_RC" in
        1) info "  Registration HTTP $REG_HTTP_CODE; curl exit 1 (connection closed after response - non-fatal)" ;;
        *) warn "  Registration HTTP $REG_HTTP_CODE but curl exit $REG_RC (unexpected)" ;;
      esac
    fi
    # Protocol verification (only when curl reported a numeric version)
    if [[ "$REG_HTTP_VERSION" == "3" ]]; then
      info "  Registration verified over HTTP/3"
    elif [[ "$REG_HTTP_VERSION" == "2" ]]; then
      warn "  Registration did not use HTTP/3 (version=2)"
    fi
    # TLS handshake timing and SLO
    if [[ -n "$REG_TLS_HANDSHAKE" ]] && [[ "$REG_TLS_HANDSHAKE" =~ ^[0-9]+\.?[0-9]*$ ]]; then
      info "  TLS handshake: ${REG_TLS_HANDSHAKE}s"
      mkdir -p "$REPO_ROOT/bench_logs" 2>/dev/null || true
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),register,h3,$REG_TLS_HANDSHAKE" >> "$REPO_ROOT/bench_logs/tls-handshake.log" 2>/dev/null || true
      if [[ "${PUSH_TLS_METRICS:-0}" == "1" ]] && [[ -x "$SCRIPT_DIR/push-tls-metrics.sh" ]]; then
        "$SCRIPT_DIR/push-tls-metrics.sh" "$REG_TLS_HANDSHAKE" "h3" 2>/dev/null || true
      fi
      MAX_TLS_HANDSHAKE="${MAX_TLS_HANDSHAKE:-0.300}"
      if [[ -n "$MAX_TLS_HANDSHAKE" ]] && [[ "$MAX_TLS_HANDSHAKE" != "0" ]]; then
        if awk "BEGIN { exit !($REG_TLS_HANDSHAKE > $MAX_TLS_HANDSHAKE) }" 2>/dev/null; then
          warn "  TLS handshake ${REG_TLS_HANDSHAKE}s exceeded SLO (${MAX_TLS_HANDSHAKE}s)"
        fi
      fi
    fi
    # Strict HTTP/3 enforcement (CI: fail if version known and not H3)
    STRICT_HTTP3="${STRICT_HTTP3:-0}"
    if [[ "$STRICT_HTTP3" == "1" ]] && [[ "$REG_HTTP_VERSION" == "2" ]]; then
      fail "Registration did not use HTTP/3 (got version=2). Set STRICT_HTTP3=0 to allow H2."
    fi
    # Optional: H2 vs H3 handshake comparison (writes bench_logs/handshake-compare.log; deletes H2 user at end)
    TLS_TEST4_TOKEN_H2=""
    if [[ "${TLS_H2_H3_COMPARE:-0}" == "1" ]] && [[ -n "$REG_TLS_HANDSHAKE" ]]; then
      _h2_email="test-tls-h2-$(date +%s)-$$@example.com"
      _saved_email="$TEST_EMAIL"
      TEST_EMAIL="$_h2_email"
      _h2_resp=$(_do_register "h2") || true
      TEST_EMAIL="$_saved_email"
      _h2_last=$(echo "$_h2_resp" | tail -1)
      _h2_code=$(echo "$_h2_last" | awk '{print $1}')
      _h2_handshake=$(echo "$_h2_last" | awk '{print $3}')
      [[ -z "$_h2_handshake" ]] && _h2_handshake=$(echo "$_h2_last" | awk '{print $2}')
      if [[ "$_h2_code" =~ ^(200|201)$ ]] && [[ -n "$_h2_handshake" ]] && [[ "$_h2_handshake" =~ ^[0-9]+\.?[0-9]*$ ]]; then
        _delta=$(awk "BEGIN { printf \"%.3f\", $REG_TLS_HANDSHAKE - $_h2_handshake }" 2>/dev/null || echo "0")
        mkdir -p "$REPO_ROOT/bench_logs" 2>/dev/null || true
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),h3,$REG_TLS_HANDSHAKE,h2,$_h2_handshake,delta,$_delta" >> "$REPO_ROOT/bench_logs/handshake-compare.log" 2>/dev/null || true
        info "  H2 vs H3 handshake: h3=${REG_TLS_HANDSHAKE}s h2=${_h2_handshake}s delta=${_delta}s"
        TLS_TEST4_TOKEN_H2=$(echo "$_h2_resp" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
        MAX_H2_H3_DELTA="${MAX_H2_H3_DELTA:-0.150}"
        if [[ -n "$MAX_H2_H3_DELTA" ]] && awk "BEGIN { exit !($REG_TLS_HANDSHAKE - $_h2_handshake > $MAX_H2_H3_DELTA) }" 2>/dev/null; then
          warn "  HTTP/3 handshake slower than HTTP/2 by ${_delta}s (threshold ${MAX_H2_H3_DELTA}s)"
        fi
      fi
    fi
  fi
  # 409 = user already exists (e.g. leftover from previous run): login and proceed so test passes; we'll delete at end
  if [[ "$REG_HTTP_CODE" == "409" ]]; then
    LOGIN_RESPONSE=""
    if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
      LOGIN_RESPONSE=$(curl --cacert "$CA_CERT" -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" -H "Content-Type: application/json" \
        -X POST "https://$HOST:${PORT}/api/auth/login" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1) || true
    else
      LOGIN_RESPONSE=$(curl -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" -H "Content-Type: application/json" \
        -X POST "https://$HOST:${PORT}/api/auth/login" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1) || true
    fi
    LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
    if [[ "$LOGIN_CODE" == "200" ]]; then
      REG_OK=true
      TLS_TEST4_TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
      info "  User already existed (409); logged in for gRPC test and cleanup"
    fi
  fi
  fi  # end else (curl registration path)

  if [[ "$REG_OK" == "true" ]]; then
    GRPC_AUTH_OK=0
    # gRPC Authenticate: MetalLB :443 only (same as Test 2 — no NodePort / port-forward / 127.0.0.1)
    if [[ -n "${TARGET_IP:-}" ]] && [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
      GRPC_AUTH_TEST=$(grpcurl -cacert "$CA_CERT" -authority "$HOST" -max-time 10 \
        -import-path "$PROTO_DIR" -proto "$PROTO_DIR/auth.proto" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
        "${TARGET_IP}:443" auth.AuthService/Authenticate 2>&1) || GRPC_AUTH_RC=$?
      if echo "$GRPC_AUTH_TEST" | grep -q "token"; then
        test_result 0 "gRPC Authenticate via LB IP: PASSED"
        GRPC_AUTH_OK=1
      fi
    fi
    if [[ $GRPC_AUTH_OK -eq 0 ]]; then
      if [[ -n "${TARGET_IP:-}" ]] && [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
        test_result 1 "gRPC Authenticate via LB IP: FAILED (check Caddy→Envoy auth route)"
      else
        test_result 1 "gRPC Authenticate: FAILED (TARGET_IP + CA_CERT required; no localhost fallbacks)"
      fi
    fi
  else
    # Report why registration failed so user can diagnose (curl exit, HTTP code, or body hint)
    if [[ "$REG_RC" -ne 0 ]]; then
      info "  Register curl exit: $REG_RC (e.g. 7=connect refused, 28=timeout, 60/77=TLS)"
    fi
    if [[ -n "$REG_HTTP_CODE" ]]; then
      info "  Register HTTP code: $REG_HTTP_CODE"
    fi
    if [[ -n "$REGISTER_RESPONSE" ]] && [[ "$REG_HTTP_CODE" =~ ^[0-9]+$ ]]; then
      REG_BODY=$(echo "$REGISTER_RESPONSE" | sed -e '$d' | head -1)
      [[ -n "$REG_BODY" ]] && [[ ${#REG_BODY} -lt 120 ]] &&     info "  Response: $REG_BODY"
    fi
    test_result 1 "gRPC Authenticate test skipped (user registration failed)"
  fi

  # Cleanup: delete test user(s) so next run doesn't get 409
  _delete_account() {
    local tok="$1" code
    if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
      code="$(curl --cacert "$CA_CERT" -sS -o /dev/null -w "%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" -H "Authorization: Bearer $tok" \
        -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>/dev/null || echo "000")"
    else
      code="$(curl -k -sS -o /dev/null -w "%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" -H "Authorization: Bearer $tok" \
        -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>/dev/null || echo "000")"
    fi
    [[ "$code" == "202" || "$code" == "204" ]]
  }
  if [[ -n "${TLS_TEST4_TOKEN:-}" ]]; then
    _delete_account "$TLS_TEST4_TOKEN" && info "  Test 4 cleanup: deleted test user" || true
  fi
  if [[ -n "${TLS_TEST4_TOKEN_H2:-}" ]]; then
    _delete_account "$TLS_TEST4_TOKEN_H2" && info "  Test 4 cleanup: deleted H2 compare user" || true
  fi
else
  test_result 1 "gRPC Authenticate test skipped (prerequisites not met)"
fi

# Test 5: Certificate material (edge: leaf-only tls.crt is OK; CA in dev-root-ca / ca.crt)
say "Test 5: Certificate Chain Completeness (leaf + CA may be separate secrets)"
CERT_COUNT=0
CADDY_POD=$(_kb -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$CADDY_POD" ]]; then
  # 1) Try pod mount path (Caddy cert mount)
  CERT_FILE=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- cat /etc/caddy/certs/tls.crt 2>/dev/null || echo "")
  [[ -z "$CERT_FILE" ]] && CERT_FILE=$(_kb -n "$NS_ING" exec "$CADDY_POD" -- cat /etc/certs/tls.crt 2>/dev/null || echo "")
  if [[ -n "$CERT_FILE" ]]; then
    CERT_COUNT=$(echo "$CERT_FILE" | grep -c "BEGIN CERTIFICATE" || echo "0")
  fi
fi
# 2) Fallback: get chain from Kubernetes secret (leaf + CA)
if [[ -z "$CERT_FILE" ]] || [[ "${CERT_COUNT:-0}" -lt 2 ]]; then
  LEAF_TLS_SECRET="${LEAF_TLS_SECRET:-off-campus-housing-local-tls}"
  SECRET_LEAF=$(_kb -n "$NS_ING" get secret "$LEAF_TLS_SECRET" -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  SECRET_CA=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$SECRET_LEAF" ]]; then
    SECRET_CHAIN="$SECRET_LEAF"
    [[ -n "$SECRET_CA" ]] && SECRET_CHAIN="$SECRET_LEAF"$'\n'"$SECRET_CA"
    CERT_COUNT=$(echo "$SECRET_CHAIN" | grep -c "BEGIN CERTIFICATE" || echo "0")
  fi
  if [[ "${CERT_COUNT:-0}" -lt 2 ]] && [[ -n "$SECRET_CA" ]] && [[ -z "$SECRET_LEAF" ]]; then
    CERT_COUNT=$(echo "$SECRET_CA" | grep -c "BEGIN CERTIFICATE" || echo "0")
    SECRET_CHAIN="$SECRET_CA"
  fi
fi
# When we have 1 cert (e.g. from pod), check dev-root-ca so "leaf + CA in separate secrets" passes
if [[ "${CERT_COUNT:-0}" -eq 1 ]] && [[ -z "${SECRET_CA:-}" ]]; then
  SECRET_CA=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
fi
if [[ -n "$CERT_COUNT" ]] && [[ "$CERT_COUNT" =~ ^[0-9]+$ ]] && [[ $CERT_COUNT -ge 2 ]]; then
  test_result 0 "Certificate chain completeness: PASSED ($CERT_COUNT certificates)"
elif [[ "${CERT_COUNT:-0}" -eq 1 ]] && [[ -n "${SECRET_CA:-}" ]]; then
  # Leaf in off-campus-housing-local-tls + CA in dev-root-ca (separate secrets) is valid
  test_result 0 "Certificate chain completeness: PASSED (leaf in $LEAF_TLS_SECRET + CA in dev-root-ca)"
elif [[ "${CERT_COUNT:-0}" -eq 1 ]]; then
  test_result 1 "Certificate chain completeness: FAILED (need leaf tls.crt + dev-root-ca; reissue writes leaf-only tls.crt)"
else
  test_result 1 "Certificate chain test: FAILED (could not retrieve chain from pod or secret)"
fi

# Test 6: mTLS Configuration Check
say "Test 6: mTLS Configuration Check"
SERVICES=("auth-service" "listings-service" "booking-service" "messaging-service" "trust-service" "analytics-service" "media-service" "notification-service")
MTLS_CAPABLE=0
MTLS_ENABLED=0

for svc in "${SERVICES[@]}"; do
  POD=$(_kb -n "$NS" get pods -l app="$svc" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [[ -n "$POD" ]]; then
    HAS_CA=$(_kb -n "$NS" exec "$POD" -- test -f /etc/certs/ca.crt 2>/dev/null && echo "yes" || echo "no")
    REQUIRE_CLIENT=$(_kb -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[0].env[?(@.name=="GRPC_REQUIRE_CLIENT_CERT")].value}' 2>/dev/null || echo "false")
    
    if [[ "$HAS_CA" == "yes" ]]; then
      MTLS_CAPABLE=$((MTLS_CAPABLE + 1))
      if [[ "$REQUIRE_CLIENT" == "true" ]]; then
        MTLS_ENABLED=$((MTLS_ENABLED + 1))
      fi
    fi
  fi
done

if [[ $MTLS_CAPABLE -eq ${#SERVICES[@]} ]]; then
  test_result 0 "mTLS capability: PASSED (all services have CA cert)"
else
  test_result 1 "mTLS capability: FAILED ($MTLS_CAPABLE/${#SERVICES[@]} services have CA cert)"
fi

info "  mTLS enabled: $MTLS_ENABLED/${#SERVICES[@]} services (dev mode: disabled by default)"

# Unified health: scripts/lib/grpc-http3-health.sh — MetalLB :443 only (no ClusterIP / 127.0.0.1 / port-forward)
say "Unified health: Caddy HTTP/3 + gRPC (MetalLB :443)"
export CA_CERT NS HOST PORT TARGET_IP SCRIPT_DIR
[[ -f "$SCRIPT_DIR/lib/http3.sh" ]] && . "$SCRIPT_DIR/lib/http3.sh"
strict_http3_curl() { http3_curl --cacert "$CA_CERT" "$@"; }
if [[ -f "$SCRIPT_DIR/lib/grpc-http3-health.sh" ]]; then
  . "$SCRIPT_DIR/lib/grpc-http3-health.sh"
  run_grpc_http3_health_checks
else
  warn "grpc-http3-health.sh not found; skipping unified health block"
fi

# Cache verification (hardened: prove Redis is up after TLS/mTLS tests)
say "Cache verification (Redis)"
REDIS_POD=$(_kb -n "$NS" get pods -l app=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$REDIS_POD" ]]; then
  if _kb -n "$NS" exec "$REDIS_POD" -- redis-cli ping 2>/dev/null | grep -q PONG; then
    test_result 0 "Redis cache: PASSED"
  else
    test_result 1 "Redis cache: FAILED (ping failed)"
  fi
else
  info "Redis: Externalized (not in cluster) - cache check skipped"
fi

# DB connectivity (quick: housing 8 DBs on 5441–5448)
say "DB connectivity (quick)"
DB_PORTS=(5441 5442 5443 5444 5445 5446 5447 5448)
DB_NAMES=(auth listings bookings messaging notification trust analytics media)
DB_OK=0
for i in "${!DB_PORTS[@]}"; do
  port="${DB_PORTS[$i]}"
  db="${DB_NAMES[$i]:-postgres}"
  if PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db" -tAc "SELECT 1;" 2>/dev/null | grep -q 1; then
    DB_OK=$((DB_OK + 1))
  elif PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d postgres -tAc "SELECT 1;" 2>/dev/null | grep -q 1; then
    DB_OK=$((DB_OK + 1))
  fi
done
if [[ $DB_OK -eq ${#DB_PORTS[@]} ]]; then
  test_result 0 "DB connectivity: PASSED ($DB_OK/${#DB_PORTS[@]} ports)"
else
  test_result 1 "DB connectivity: FAILED ($DB_OK/${#DB_PORTS[@]} ports - expected 5441-5448)"
fi

# Summary
say "=== Test Summary ==="
info "Passed: $PASSED"
info "Failed: $FAILED"
if [[ $FAILED -eq 0 ]]; then
  ok "All TLS/mTLS tests PASSED"
  exit 0
else
  fail "$FAILED test(s) FAILED"
  exit 1
fi

# Cleanup
rm -f "$CA_CERT" 2>/dev/null || true
