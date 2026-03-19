#!/usr/bin/env bash
# Housing-only: HTTP/2 + HTTP/3 smoke for auth (two users) and messaging.
# Replaces RP-specific test-microservices-http2-http3.sh for off-campus-housing-tracker.
# - Auth: register + login (User 1 and User 2) via HTTP/2 and HTTP/3.
# - Health: Caddy, api-gateway (HTTP/2 and HTTP/3 where supported).
# - Messaging: run messaging-service integration tests (DB + rate limit + spam).
#
# Protocol: HTTP/2 with --http2 (ALPN); HTTP/3 with --http3-only (QUIC). Strict TLS (CA from cluster or certs/dev-root.pem).
# Run from repo root. Requires: kubectl, curl (with --http3 for H3 tests), cluster with api-gateway + auth-service + messaging-service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

# LB IP
_live_lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
[[ -z "$_live_lb" ]] && _live_lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
if [[ -n "$_live_lb" ]]; then
  export TARGET_IP="$_live_lb"
  export REACHABLE_LB_IP="$_live_lb"
fi
unset _live_lb 2>/dev/null || true

NS="off-campus-housing-tracker"
HOST="${HOST:-off-campus-housing.local}"
AUTH_DB_PORT="${AUTH_DB_PORT:-5441}"

# Curl: prefer HTTP/3-capable
if [[ -z "${CURL_BIN:-}" ]]; then
  _curl_has_http3() { [[ -x "${1:-}" ]] && "$1" --help all 2>/dev/null | grep -q -- "--http3"; }
  if _curl_has_http3 /opt/homebrew/opt/curl/bin/curl; then CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
  elif _curl_has_http3 /usr/local/opt/curl/bin/curl; then CURL_BIN="/usr/local/opt/curl/bin/curl"
  elif _curl_has_http3 "$(command -v curl 2>/dev/null)"; then CURL_BIN="$(command -v curl)"
  else [[ -x /opt/homebrew/opt/curl/bin/curl ]] && CURL_BIN="/opt/homebrew/opt/curl/bin/curl" || CURL_BIN="curl"
  fi
  unset -f _curl_has_http3 2>/dev/null || true
fi
export CURL_BIN
export CURL_MAX_TIME="${CURL_MAX_TIME:-15}"
export CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-3}"
export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"

# Port: 443 when using LB IP, else NodePort
if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "443" ]]; then
  if [[ -n "${TARGET_IP:-}" ]]; then
    PORT="${PORT:-443}"
  else
    PORT="${PORT:-30443}"
    DETECTED=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
    [[ -n "$DETECTED" ]] && PORT=$DETECTED
  fi
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }
info() { echo "ℹ️  $*"; }

REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
mkdir -p "$REPO_ROOT/certs"
CA_CERT=""
# CA from cluster or repo
K8S_CA=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
[[ -z "$K8S_CA" ]] && K8S_CA=$(_kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA" ]] && echo "$K8S_CA" | grep -q "BEGIN CERTIFICATE"; then
  CA_CERT="/tmp/test-ca-housing-$$.pem"
  echo "$K8S_CA" > "$CA_CERT"
  ok "Using Kubernetes CA for strict TLS"
fi
if [[ -z "$CA_CERT" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  CA_CERT="$REPO_ROOT/certs/dev-root.pem"
  ok "Using repo CA: $CA_CERT"
fi
if [[ -z "$CA_CERT" ]]; then
  warn "No CA found; curl will use -k (insecure). Create certs with ./scripts/dev-generate-certs.sh and ./scripts/strict-tls-bootstrap.sh"
fi
export CA_CERT

strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    "$CURL_BIN" --cacert "$CA_CERT" "$@"
  else
    "$CURL_BIN" -k "$@"
  fi
}

# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"
strict_http3_curl() {
  local has_http3_only=0
  for _a in "$@"; do [[ "$_a" == "--http3-only" ]] && has_http3_only=1 && break; done
  local extra=()
  [[ "$has_http3_only" -eq 0 ]] && extra+=(--http3-only)
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    http3_curl --cacert "$CA_CERT" "${extra[@]}" "$@"
  else
    http3_curl -k "${extra[@]}" "$@"
  fi
}

# HTTP/3 resolve (LB IP or NodePort)
CURL_RESOLVE_IP="${TARGET_IP:-127.0.0.1}"
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]]; then
  HTTP3_RESOLVE="${HOST}:443:${TARGET_IP}"
  export HTTP3_RESOLVE
else
  HTTP3_RESOLVE="${HOST}:${PORT}:${CURL_RESOLVE_IP}"
  export HTTP3_RESOLVE
fi

verify_db_after_test() {
  local port="$1" db="$2" query="$3" label="${4:-DB check}"
  local result
  result=$(PGPASSWORD=postgres PGCONNECT_TIMEOUT=2 psql -h localhost -p "$port" -U postgres -d "$db" -tAc "$query" 2>/dev/null || echo "")
  if [[ -n "$result" ]] && [[ "$result" != "0" ]]; then
    ok "$label"
    return 0
  fi
  warn "$label: no/zero result"
  return 1
}

extract_user_id() {
  local token=$1
  [[ -z "$token" ]] && echo "" && return
  local payload=$(echo "$token" | cut -d'.' -f2)
  payload=$(echo "$payload" | tr '_-' '/+')
  local mod=$((${#payload} % 4))
  [[ $mod -eq 2 ]] && payload="${payload}=="
  [[ $mod -eq 3 ]] && payload="${payload}="
  echo "$payload" | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo ""
}

# Pre-flight: auth DB (housing uses port 5441)
say "Pre-flight: Auth DB (port $AUTH_DB_PORT)..."
AUTH_DB_CHECK=$(PGCONNECT_TIMEOUT=3 PGPASSWORD=postgres psql -h localhost -p "$AUTH_DB_PORT" -U postgres -d auth -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" 2>&1 || echo "CONNECTION_FAILED")
if echo "$AUTH_DB_CHECK" | grep -q "1"; then
  ok "Auth schema exists (port $AUTH_DB_PORT)"
else
  warn "Auth schema missing or DB unreachable (port $AUTH_DB_PORT). Auth tests may fail."
fi

# Service readiness
check_service_ready() {
  local service=$1 max_wait=${2:-90} waited=0
  say "Waiting for $service..."
  while [[ $waited -lt $max_wait ]]; do
    if kubectl -n "$NS" rollout status deployment/"$service" --timeout=5s >/dev/null 2>&1; then
      ok "$service is ready"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  warn "$service not ready within ${max_wait}s"
  return 1
}
check_service_ready "api-gateway" 60 || true
check_service_ready "auth-service" 90 || true
check_service_ready "messaging-service" 120 || true

TOKEN=""
TOKEN_USER2=""
USER1_ID=""
USER2_ID=""
TEST_EMAIL=""
TEST_EMAIL_USER2=""

say "=== Housing: HTTP/2 + HTTP/3 (auth + health + messaging integration) ==="

# Allow failures per test so we run all
set +e

# --- Test 1: Auth Register (HTTP/2) User 1 ---
say "Test 1: Auth - Register User 1 via HTTP/2"
TEST_EMAIL="microservice-test-$(date +%s)@example.com"
REGISTER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" \
  "https://$HOST:${PORT}/api/auth/register" 2>/tmp/register-h2.log) || true
REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
if [[ "$REGISTER_CODE" == "201" ]]; then
  TOKEN=$(echo "$REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER1_ID=$(extract_user_id "$TOKEN")
  ok "User 1 registered via HTTP/2"
  [[ -n "$USER1_ID" ]] && info "User 1 ID: $USER1_ID"
elif [[ "$REGISTER_CODE" == "409" ]]; then
  ok "User 1 already exists (will try login)"
else
  warn "User 1 register failed - HTTP $REGISTER_CODE"
fi

# --- Test 1b: Auth Register (HTTP/2) User 2 ---
say "Test 1b: Auth - Register User 2 via HTTP/2"
TEST_EMAIL_USER2="microservice-test-2-$(date +%s)@example.com"
REGISTER_RESPONSE_USER2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" \
  "https://$HOST:${PORT}/api/auth/register" 2>/tmp/register-user2.log) || true
REGISTER_CODE_USER2=$(echo "$REGISTER_RESPONSE_USER2" | tail -1)
if [[ "$REGISTER_CODE_USER2" == "201" ]]; then
  TOKEN_USER2=$(echo "$REGISTER_RESPONSE_USER2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER2_ID=$(extract_user_id "$TOKEN_USER2")
  ok "User 2 registered via HTTP/2"
elif [[ "$REGISTER_CODE_USER2" == "409" ]]; then
  ok "User 2 already exists"
else
  warn "User 2 register failed - HTTP $REGISTER_CODE_USER2"
fi

sleep 2

# --- Test 2: Auth Login (HTTP/3) User 1 ---
say "Test 2: Auth - Login User 1 via HTTP/3"
if [[ -z "$TOKEN" ]]; then
  LOGIN_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" \
    "https://$HOST/api/auth/login" 2>/tmp/login-h3.log) || true
  LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
  if [[ "$LOGIN_CODE" == "200" ]]; then
    TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    USER1_ID=$(extract_user_id "$TOKEN")
    ok "User 1 login via HTTP/3"
  else
    warn "User 1 login via HTTP/3 failed - HTTP $LOGIN_CODE"
  fi
else
  ok "User 1 already has token"
fi

# --- Test 2b: Auth Login (HTTP/3) User 2 ---
say "Test 2b: Auth - Login User 2 via HTTP/3"
if [[ -z "$TOKEN_USER2" ]]; then
  LOGIN_RESPONSE_USER2=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" \
    "https://$HOST/api/auth/login" 2>/tmp/login-user2-h3.log) || true
  LOGIN_CODE_USER2=$(echo "$LOGIN_RESPONSE_USER2" | tail -1)
  if [[ "$LOGIN_CODE_USER2" == "200" ]]; then
    TOKEN_USER2=$(echo "$LOGIN_RESPONSE_USER2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    USER2_ID=$(extract_user_id "$TOKEN_USER2")
    ok "User 2 login via HTTP/3"
  else
    warn "User 2 login via HTTP/3 failed - HTTP $LOGIN_CODE_USER2"
  fi
else
  ok "User 2 already has token"
fi

# --- Test 3: Caddy health HTTP/2 ---
say "Test 3: Caddy health via HTTP/2"
H2_CODE=$(strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/_caddy/healthz" 2>/dev/null || echo "000")
[[ "$H2_CODE" == "200" ]] && ok "Caddy health HTTP/2: $H2_CODE" || warn "Caddy health HTTP/2: $H2_CODE"

# --- Test 4: Caddy health HTTP/3 ---
say "Test 4: Caddy health via HTTP/3"
H3_CODE=$(strict_http3_curl -sS -o /dev/null -w "%{http_code}" --http3-only --max-time 15 \
  --resolve "$HTTP3_RESOLVE" "https://$HOST/_caddy/healthz" 2>/dev/null || echo "000")
[[ "$H3_CODE" == "200" ]] && ok "Caddy health HTTP/3: $H3_CODE" || warn "Caddy health HTTP/3: $H3_CODE"

# --- Test 5: API Gateway health HTTP/2 ---
say "Test 5: API Gateway health via HTTP/2"
GW_CODE=$(strict_curl -sS -o /dev/null -w "%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}/api/healthz" 2>/dev/null || echo "000")
[[ "$GW_CODE" == "200" ]] && ok "API Gateway health: $GW_CODE" || warn "API Gateway health: $GW_CODE"

# --- Test 6: Messaging-service integration tests ---
say "Test 6: Messaging-service integration tests (vitest)"
if command -v pnpm >/dev/null 2>&1; then
  (cd "$REPO_ROOT" && pnpm --filter messaging-service test:integration 2>&1) && ok "Messaging integration tests passed" || warn "Messaging integration tests failed or skipped (DB/Redis/Trust may be required)"
else
  warn "pnpm not found; skipping messaging integration tests"
fi

set -e
say "=== Housing HTTP/2 + HTTP/3 suite done ==="
