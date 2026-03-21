#!/usr/bin/env bash
# Housing-only: HTTP/2 + HTTP/3 smoke for auth (two users) and messaging.
# Replaces RP-specific test-microservices-http2-http3.sh for off-campus-housing-tracker.
# Booking: at end (Test 19), runs test-booking-http2-http3.sh (MetalLB HTTP/2+HTTP/3 + edge grpcurl) unless SKIP_BOOKING_IN_HOUSING_SUITE=1.
# - Auth: register + login (User 1 and User 2) via HTTP/2 and HTTP/3.
# - Health: Caddy, api-gateway (HTTP/2 and HTTP/3 where supported).
# - Messaging: run messaging-service integration tests (DB + rate limit + spam).
#
# Protocol: HTTP/2 with --http2 (ALPN); HTTP/3 with --http3-only (QUIC). Strict TLS (CA from cluster or certs/dev-root.pem).
# Run from repo root. Requires: kubectl, curl (with --http3 for H3 tests), cluster with api-gateway + auth-service + messaging-service.
# Optional packet capture: ./scripts/run-suite-with-packet-capture.sh "$0" "$@"
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

LATENCY_DIR="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}/bench_logs/latency-$(date +%Y%m%d-%H%M%S)"
LATENCY_CSV="$LATENCY_DIR/service-latency.csv"
mkdir -p "$LATENCY_DIR"
echo "service,protocol,http_code,time_total_ms" > "$LATENCY_CSV"

append_latency_row() {
  local service="$1" protocol="$2" code="$3" seconds="$4"
  local ms="0"
  if [[ -n "$seconds" ]]; then
    ms=$(python3 - <<'PY' "$seconds"
import sys
try:
    print(int(float(sys.argv[1]) * 1000))
except Exception:
    print(0)
PY
)
  fi
  echo "${service},${protocol},${code:-000},${ms}" >> "$LATENCY_CSV"
}

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

grpcurl_with_timeout() {
  local timeout_sec="${1:-10}"
  shift
  local cmd=("$@")
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" "${cmd[@]}" 2>&1
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$timeout_sec" "${cmd[@]}" 2>&1
  else
    "${cmd[@]}" 2>&1 &
    local pid=$!
    (
      sleep "$timeout_sec"
      kill "$pid" 2>/dev/null || true
    ) &
    wait "$pid" 2>/dev/null || echo "grpcurl timeout after ${timeout_sec}s"
  fi
}

grpc_test() {
  local service_label="$1"
  local deploy_name="$2"
  local grpc_port="$3"
  local local_port=$((15000 + RANDOM % 1000))
  local pf_pid=""
  local out=""

  if ! kubectl -n "$NS" get deployment "$deploy_name" >/dev/null 2>&1; then
    info "Skipping gRPC health ($service_label) - deployment not present"
    return 0
  fi

  kubectl -n "$NS" port-forward "deployment/$deploy_name" "${local_port}:${grpc_port}" >/dev/null 2>&1 &
  pf_pid=$!
  sleep 2
  if ! kill -0 "$pf_pid" 2>/dev/null; then
    echo "port-forward failed"
    return 1
  fi

  local proto_dir="$REPO_ROOT/proto"
  local cert_args=()
  if [[ -f "/tmp/grpc-certs/ca.crt" ]]; then
    cert_args+=("-cacert" "/tmp/grpc-certs/ca.crt")
  elif [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
    cert_args+=("-cacert" "$CA_CERT")
  else
    cert_args+=("-insecure")
  fi
  if [[ -f "/tmp/grpc-certs/tls.crt" ]] && [[ -f "/tmp/grpc-certs/tls.key" ]]; then
    cert_args+=("-cert" "/tmp/grpc-certs/tls.crt" "-key" "/tmp/grpc-certs/tls.key")
  fi

  out=$(grpcurl_with_timeout 12 grpcurl \
    "${cert_args[@]}" \
    -authority "$HOST" \
    -import-path "$proto_dir" \
    -proto "$proto_dir/health.proto" \
    -d '{"service":""}' \
    "127.0.0.1:${local_port}" grpc.health.v1.Health/Check) || true

  kill "$pf_pid" 2>/dev/null || true
  wait "$pf_pid" 2>/dev/null || true

  if echo "$out" | grep -q -E '"status": ?"SERVING"|SERVING'; then
    ok "gRPC health OK ($service_label)"
  else
    warn "gRPC health failed ($service_label)"
    echo "Response: $(echo "$out" | head -2)"
  fi
}

generate_latency_svg_graph() {
  local csv_path="$1"
  local svg_path="$2"
  python3 - <<'PY' "$csv_path" "$svg_path"
import csv, sys, math
from collections import defaultdict

csv_path, svg_path = sys.argv[1], sys.argv[2]
rows = []
with open(csv_path, newline="") as f:
    r = csv.DictReader(f)
    for row in r:
      try:
        rows.append({
          "service": row["service"],
          "protocol": row["protocol"],
          "ms": int(row["time_total_ms"]),
          "code": row["http_code"],
        })
      except Exception:
        pass

if not rows:
    with open(svg_path, "w") as f:
      f.write('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><text x="20" y="40">No latency rows available</text></svg>')
    sys.exit(0)

agg = defaultdict(lambda: {"h2": [], "h3": []})
for row in rows:
    k = "h3" if row["protocol"].upper() == "HTTP3" else "h2"
    agg[row["service"]][k].append(row["ms"])

services = sorted(agg.keys())
def avg(v):
    return int(sum(v) / len(v)) if v else 0

max_ms = 1
for s in services:
    max_ms = max(max_ms, avg(agg[s]["h2"]), avg(agg[s]["h3"]))

bar_w = 18
group_w = 56
left = 80
top = 30
height = 260
width = left + len(services) * group_w + 40
svg_h = 360

def y_for(ms):
    return top + height - int((ms / max_ms) * (height - 10))

out = []
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{svg_h}">')
out.append('<style>text{font-family:Arial,sans-serif;font-size:11px}.label{font-size:10px}</style>')
out.append(f'<text x="20" y="18" font-size="14">Per-service latency (avg ms): HTTP/2 vs HTTP/3</text>')
out.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top+height}" stroke="#444"/>')
out.append(f'<line x1="{left}" y1="{top+height}" x2="{width-20}" y2="{top+height}" stroke="#444"/>')

for i in range(5):
    v = int(max_ms * i / 4)
    y = y_for(v)
    out.append(f'<line x1="{left}" y1="{y}" x2="{width-20}" y2="{y}" stroke="#eee"/>')
    out.append(f'<text x="10" y="{y+4}" class="label">{v}ms</text>')

for idx, s in enumerate(services):
    x0 = left + idx * group_w + 10
    h2 = avg(agg[s]["h2"])
    h3 = avg(agg[s]["h3"])
    y2 = y_for(h2)
    y3 = y_for(h3)
    out.append(f'<rect x="{x0}" y="{y2}" width="{bar_w}" height="{top+height-y2}" fill="#4e79a7"/>')
    out.append(f'<rect x="{x0+bar_w+4}" y="{y3}" width="{bar_w}" height="{top+height-y3}" fill="#f28e2b"/>')
    out.append(f'<text x="{x0}" y="{top+height+14}" class="label">{s[:7]}</text>')

out.append(f'<rect x="{left}" y="{svg_h-40}" width="12" height="12" fill="#4e79a7"/><text x="{left+18}" y="{svg_h-30}" class="label">HTTP/2</text>')
out.append(f'<rect x="{left+90}" y="{svg_h-40}" width="12" height="12" fill="#f28e2b"/><text x="{left+108}" y="{svg_h-30}" class="label">HTTP/3</text>')
out.append("</svg>")

with open(svg_path, "w") as f:
    f.write("\n".join(out))
PY
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

# Test 6a: Messaging Service - Forum Endpoints (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6a: Messaging Service - Create Forum Post via HTTP/2"
  FORUM_POST_RC=0
  FORUM_POST_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Test Forum Post","content":"This is a test post via HTTP/2","flair":"general"}' 2>&1) || FORUM_POST_RC=$?
  FORUM_POST_CODE=$(echo "$FORUM_POST_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_RC" -ne 0 ]]; then
    warn "Create forum post request failed (curl exit $FORUM_POST_RC)"
  elif [[ "$FORUM_POST_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post works via HTTP/2"
    FORUM_POST_ID=$(echo "$FORUM_POST_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    [[ -n "$FORUM_POST_ID" ]] && echo "Forum post ID: $FORUM_POST_ID"
    verify_db_after_test 5444 messaging "SELECT COUNT(*) FROM forum.posts WHERE title = 'Test Forum Post'" "Test 6a DB: forum post in forum.posts" || true
  else
    warn "Create forum post failed - HTTP $FORUM_POST_CODE"
    echo "Response body: $(echo "$FORUM_POST_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping forum post creation - messaging-service not available or no auth token"
fi

# Test 6b: Messaging Service - Forum Endpoints (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 6b: Messaging Service - Create Forum Post via HTTP/3"
  FORUM_POST_H3_RC=0
  FORUM_POST_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts" \
    -d '{"title":"Test Forum Post H3","content":"This is a test post via HTTP/3","flair":"general"}' 2>&1) || FORUM_POST_H3_RC=$?
  if [[ "$FORUM_POST_H3_RC" -ne 0 ]]; then
    _forum_h3_code=$(echo "$FORUM_POST_H3_RESPONSE" | tail -1)
    warn "Create forum post via HTTP/3 failed (HTTP ${_forum_h3_code:-000}, curl exit $FORUM_POST_H3_RC: $(_http3_exit_meaning "$FORUM_POST_H3_RC"))"
  elif [[ -n "$FORUM_POST_H3_RESPONSE" ]]; then
    FORUM_POST_H3_CODE=$(echo "$FORUM_POST_H3_RESPONSE" | tail -1)
    if [[ "$FORUM_POST_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Create forum post works via HTTP/3"
      FORUM_POST_H3_ID=$(echo "$FORUM_POST_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      verify_db_after_test 5444 messaging "SELECT COUNT(*) FROM forum.posts WHERE title = 'Test Forum Post H3'" "Test 6b DB: H3 forum post in forum.posts" || true
    else
      warn "Create forum post via HTTP/3 failed - HTTP $FORUM_POST_H3_CODE"
      echo "Response body: $(echo "$FORUM_POST_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  warn "Skipping forum post creation via HTTP/3 - messaging-service not available or no auth token"
fi

# Test 7: Messaging Service - Get Forum Posts (HTTP/2) — strict TLS + resolve; retry up to 2x on curl exit 7 (connection)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 7: Messaging Service - Get Forum Posts via HTTP/2"
  GET_FORUM_RC=0
  GET_FORUM_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X GET "https://$HOST:${PORT}/api/forum/posts" 2>&1) || GET_FORUM_RC=$?
  _retry=0
  while [[ "$GET_FORUM_RC" -eq 7 ]] && [[ -z "$(echo "$GET_FORUM_RESPONSE" | tail -1 | grep -E '^[0-9]+$')" ]] && [[ "$_retry" -lt 2 ]]; do
    sleep 2
    GET_FORUM_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      -X GET "https://$HOST:${PORT}/api/forum/posts" 2>&1) || GET_FORUM_RC=$?
    _retry=$((_retry + 1))
  done
  GET_FORUM_CODE=$(echo "$GET_FORUM_RESPONSE" | tail -1)
  if [[ "$GET_FORUM_RC" -ne 0 ]]; then
    warn "Get forum posts request failed (curl exit $GET_FORUM_RC)"
  elif [[ "$GET_FORUM_CODE" =~ ^(200)$ ]]; then
    ok "Get forum posts works via HTTP/2"
    # Extract post ID for comment test (if not already set)
    if [[ -z "${FORUM_POST_ID:-}" ]]; then
      FORUM_POST_ID=$(echo "$GET_FORUM_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      if [[ -z "$FORUM_POST_ID" ]]; then
        # Try parsing as JSON array
        FORUM_POST_ID=$(echo "$GET_FORUM_RESPONSE" | sed '$d' | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0].get('id', '') if isinstance(data, list) and len(data) > 0 else '')" 2>/dev/null || echo "")
      fi
      [[ -n "$FORUM_POST_ID" ]] && echo "Found forum post ID: $FORUM_POST_ID"
    fi
  else
    warn "Get forum posts failed - HTTP $GET_FORUM_CODE"
    echo "Response body: $(echo "$GET_FORUM_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get forum posts - messaging-service not available or no auth token"
fi

# Test 7b: Messaging Service - Add Comment to Forum Post (HTTP/3) - User 2 comments on User 1's post
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 7b: Messaging Service - Add Comment to Forum Post via HTTP/3 (User 2)"
  ADD_COMMENT_RC=0
  # Increased timeout to 60s and add retry logic for HTTP/3 (QUIC can be slower)
  ADD_COMMENT_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 60 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
    -d '{"content":"Great post! This is a test comment via HTTP/3 from User 2"}' 2>&1) || ADD_COMMENT_RC=$?
  
  # Retry once if timeout (exit code 28)
  if [[ "$ADD_COMMENT_RC" -eq 28 ]]; then
    warn "Add comment via HTTP/3 timed out, retrying once..."
    sleep 2
    ADD_COMMENT_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 60 \
      -H "Host: $HOST" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      --resolve "$HTTP3_RESOLVE" \
      -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
      -d '{"content":"Great post! This is a test comment via HTTP/3 from User 2 (retry)"}' 2>&1) || ADD_COMMENT_RC=$?
  fi
  
  if [[ "$ADD_COMMENT_RC" -ne 0 ]]; then
    if [[ "$ADD_COMMENT_RC" -eq 28 ]]; then
      warn "Add comment via HTTP/3 failed (curl exit $ADD_COMMENT_RC - timeout after retry)"
    else
      warn "Add comment via HTTP/3 failed (curl exit $ADD_COMMENT_RC)"
    fi
  elif [[ -n "$ADD_COMMENT_RESPONSE" ]]; then
    ADD_COMMENT_CODE=$(echo "$ADD_COMMENT_RESPONSE" | tail -1)
    if [[ "$ADD_COMMENT_CODE" =~ ^(200|201)$ ]]; then
      ok "Add comment to forum post works via HTTP/3"
      [[ -n "${FORUM_POST_ID:-}" ]] && verify_db_after_test 5444 messaging "SELECT 1 FROM forum.comments WHERE post_id = '${FORUM_POST_ID}' AND content LIKE '%HTTP/3%' LIMIT 1" "Test 7b DB: comment in forum.comments" || true
      # Extract COMMENT_ID for vote tests
      [[ -z "${COMMENT_ID:-}" ]] && COMMENT_ID=$(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      [[ -z "${COMMENT_ID:-}" ]] && command -v jq >/dev/null 2>&1 && COMMENT_ID=$(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | jq -r '.id // empty' 2>/dev/null || echo "")
    else
      warn "Add comment via HTTP/3 failed - HTTP $ADD_COMMENT_CODE"
      echo "Response body: $(echo "$ADD_COMMENT_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${FORUM_POST_ID:-}" ]]; then
    warn "Skipping add comment - Forum post ID not available"
  else
    warn "Skipping add comment - messaging-service not available or no auth token"
  fi
fi

# Test 7c: Forum post vote (HTTP/2) — hits forum.post_votes (port 5444, CURRENT_DB_SCHEMA_REPORT)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 7c: Messaging Service - Vote on Forum Post via HTTP/2"
  POST_VOTE_RC=0
  POST_VOTE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$FORUM_POST_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || POST_VOTE_RC=$?
  POST_VOTE_CODE=$(echo "$POST_VOTE_RESPONSE" | tail -1)
  if [[ "$POST_VOTE_RC" -ne 0 ]]; then
    warn "Forum post vote via HTTP/2 failed (curl exit $POST_VOTE_RC)"
  elif [[ "$POST_VOTE_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum post vote works via HTTP/2 (forum.post_votes)"
    [[ -n "${USER1_ID:-}" ]] && ( verify_db_after_test 5444 messaging "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7c DB: post_votes" || verify_db_after_test 5444 messaging "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7c DB: post_votes (records)" ) || true
  else
    warn "Forum post vote via HTTP/2 failed - HTTP $POST_VOTE_CODE"
    [[ "$POST_VOTE_CODE" == "502" ]] && info "  502 on forum vote: If schema preflight passed, run ./scripts/diagnose-502-and-analytics.sh. Ensure Postgres (not SSH) listens on 0.0.0.0:5444 so pods (host.docker.internal) can connect."
  fi
fi

# Test 7d: Forum post vote (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 7d: Messaging Service - Vote on Forum Post via HTTP/3"
  POST_VOTE_H3_RC=0
  POST_VOTE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || POST_VOTE_H3_RC=$?
  POST_VOTE_H3_CODE=$(echo "$POST_VOTE_H3_RESPONSE" | tail -1)
  if [[ "$POST_VOTE_H3_RC" -ne 0 ]]; then
    warn "Forum post vote via HTTP/3 failed (curl exit $POST_VOTE_H3_RC)"
  elif [[ "$POST_VOTE_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum post vote works via HTTP/3 (forum.post_votes)"
    [[ -n "${USER1_ID:-}" ]] && ( verify_db_after_test 5444 messaging "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7d DB: H3 post_votes" || verify_db_after_test 5444 messaging "SELECT 1 FROM forum.post_votes WHERE post_id = '${FORUM_POST_ID}'::uuid AND user_id = '${USER1_ID}'::uuid LIMIT 1" "Test 7d DB: H3 post_votes (records)" ) || true
  else
    warn "Forum post vote via HTTP/3 failed - HTTP $POST_VOTE_H3_CODE"
  fi
fi

# Test 7e: Forum comment vote (HTTP/2) — hits forum.comment_votes (port 5444)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${COMMENT_ID:-}" ]]; then
  say "Test 7e: Messaging Service - Vote on Forum Comment via HTTP/2"
  COMMENT_VOTE_RC=0
  COMMENT_VOTE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/comments/$COMMENT_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || COMMENT_VOTE_RC=$?
  COMMENT_VOTE_CODE=$(echo "$COMMENT_VOTE_RESPONSE" | tail -1)
  if [[ "$COMMENT_VOTE_RC" -ne 0 ]]; then
    warn "Forum comment vote via HTTP/2 failed (curl exit $COMMENT_VOTE_RC)"
  elif [[ "$COMMENT_VOTE_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum comment vote works via HTTP/2 (forum.comment_votes)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5444 messaging "SELECT 1 FROM forum.comment_votes WHERE comment_id = '${COMMENT_ID}' AND user_id = '${USER1_ID}' LIMIT 1" "Test 7e DB: comment_votes" || true
  else
    warn "Forum comment vote via HTTP/2 failed - HTTP $COMMENT_VOTE_CODE"
  fi
else
  [[ -z "${COMMENT_ID:-}" ]] && info "Skipping forum comment vote - COMMENT_ID not available (from Test 7b)"
fi

# Test 7f: Forum comment vote (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${COMMENT_ID:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 7f: Messaging Service - Vote on Forum Comment via HTTP/3"
  COMMENT_VOTE_H3_RC=0
  COMMENT_VOTE_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 20 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/comments/$COMMENT_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || COMMENT_VOTE_H3_RC=$?
  COMMENT_VOTE_H3_CODE=$(echo "$COMMENT_VOTE_H3_RESPONSE" | tail -1)
  if [[ "$COMMENT_VOTE_H3_RC" -ne 0 ]]; then
    warn "Forum comment vote via HTTP/3 failed (curl exit $COMMENT_VOTE_H3_RC)"
  elif [[ "$COMMENT_VOTE_H3_CODE" =~ ^(200|201)$ ]]; then
    ok "Forum comment vote works via HTTP/3 (forum.comment_votes)"
    [[ -n "${USER1_ID:-}" ]] && verify_db_after_test 5444 messaging "SELECT 1 FROM forum.comment_votes WHERE comment_id = '${COMMENT_ID}' AND user_id = '${USER1_ID}' LIMIT 1" "Test 7f DB: H3 comment_votes" || true
  else
    warn "Forum comment vote via HTTP/3 failed - HTTP $COMMENT_VOTE_H3_CODE"
  fi
fi

# Test 8: Messaging Service - P2P Direct Message (HTTP/2) - User 1 to User 2
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${USER2_ID:-}" ]]; then
  say "Test 8: Messaging Service - Send P2P Direct Message via HTTP/2 (User 1 -> User 2)"
  SEND_MSG_RC=0
  SEND_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages" \
    -d "{\"recipient_id\":\"$USER2_ID\",\"message_type\":\"direct\",\"subject\":\"Test P2P Message\",\"content\":\"Hello User 2, this is a test message via HTTP/2\"}" 2>&1) || SEND_MSG_RC=$?
  SEND_MSG_CODE=$(echo "$SEND_MSG_RESPONSE" | tail -1)
  if [[ "$SEND_MSG_RC" -ne 0 ]]; then
    warn "Send P2P message request failed (curl exit $SEND_MSG_RC)"
  elif [[ "$SEND_MSG_CODE" =~ ^(200|201)$ ]]; then
    ok "Send P2P message works via HTTP/2"
    MESSAGE_ID=$(echo "$SEND_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Send P2P message failed - HTTP $SEND_MSG_CODE"
    echo "Response body: $(echo "$SEND_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${USER2_ID:-}" ]]; then
    warn "Skipping P2P message test - User 2 ID not available"
  else
    warn "Skipping P2P message test - messaging-service not available or no auth token"
  fi
fi

# Test 8b: Messaging Service - P2P Direct Message (HTTP/3) - User 2 to User 1
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${USER1_ID:-}" ]]; then
  say "Test 8b: Messaging Service - Send P2P Direct Message via HTTP/3 (User 2 -> User 1)"
  SEND_MSG_H3_RC=0
  SEND_MSG_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d "{\"recipient_id\":\"$USER1_ID\",\"message_type\":\"direct\",\"subject\":\"Test P2P Reply\",\"content\":\"Hello User 1, this is a reply via HTTP/3\"}" 2>&1) || SEND_MSG_H3_RC=$?
  if [[ "$SEND_MSG_H3_RC" -ne 0 ]]; then
    warn "Send P2P message via HTTP/3 failed (curl exit $SEND_MSG_H3_RC)"
  elif [[ -n "$SEND_MSG_H3_RESPONSE" ]]; then
    SEND_MSG_H3_CODE=$(echo "$SEND_MSG_H3_RESPONSE" | tail -1)
    if [[ "$SEND_MSG_H3_CODE" =~ ^(200|201)$ ]]; then
      ok "Send P2P message works via HTTP/3"
      MESSAGE_H3_ID=$(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "Send P2P message via HTTP/3 failed - HTTP $SEND_MSG_H3_CODE"
      echo "Response body: $(echo "$SEND_MSG_H3_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${USER1_ID:-}" ]]; then
    warn "Skipping P2P message reply test - User 1 ID not available"
  else
    warn "Skipping P2P message reply test - messaging-service not available or no auth token"
  fi
fi

# Test 9: Messaging Service - Get Messages (HTTP/2) - User 2's inbox
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]]; then
  say "Test 9: Messaging Service - Get Messages via HTTP/2 (User 2's inbox)"
  GET_MSG_RC=0
  GET_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages" 2>&1) || GET_MSG_RC=$?
  GET_MSG_CODE=$(echo "$GET_MSG_RESPONSE" | tail -1)
  if [[ "$GET_MSG_RC" -ne 0 ]]; then
    warn "Get messages request failed (curl exit $GET_MSG_RC)"
  elif [[ "$GET_MSG_CODE" =~ ^(200)$ ]]; then
    ok "Get messages works via HTTP/2"
  else
    warn "Get messages failed - HTTP $GET_MSG_CODE"
    echo "Response body: $(echo "$GET_MSG_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping get messages - messaging-service not available or no auth token"
fi

# Test 9b: Messaging Service - Create Group Chat (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9b: Messaging Service - Create Group Chat via HTTP/2"
  CREATE_GROUP_RC=0
  CREATE_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups" \
    -d '{"name":"My Custom Group Name","description":"A test group for HTTP/2/3 testing"}' 2>&1) || CREATE_GROUP_RC=$?
  CREATE_GROUP_CODE=$(echo "$CREATE_GROUP_RESPONSE" | tail -1)
  if [[ "$CREATE_GROUP_RC" -ne 0 ]]; then
    warn "Create group request failed (curl exit $CREATE_GROUP_RC)"
  elif [[ "$CREATE_GROUP_CODE" =~ ^(200|201)$ ]]; then
    ok "Create group works via HTTP/2"
    GROUP_ID=$(echo "$CREATE_GROUP_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    [[ -n "$GROUP_ID" ]] && echo "Group ID: $GROUP_ID"
    [[ -n "$GROUP_ID" ]] && verify_db_after_test 5444 messaging "SELECT 1 FROM messages.groups WHERE id = '${GROUP_ID}' AND name = 'My Custom Group Name' LIMIT 1" "Test 9b DB: group in messages.groups" || true
  else
    warn "Create group failed - HTTP $CREATE_GROUP_CODE"
    echo "Response body: $(echo "$CREATE_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping create group - messaging-service not available or no auth token"
fi

# Test 9c: Messaging Service - Add User 2 to Group (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${GROUP_ID:-}" ]] && [[ -n "${USER2_ID:-}" ]]; then
  say "Test 9c: Messaging Service - Add User 2 to Group via HTTP/2"
  ADD_MEMBER_RC=0
  ADD_MEMBER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/members" \
    -d "{\"user_id\":\"$USER2_ID\"}" 2>&1) || ADD_MEMBER_RC=$?
  ADD_MEMBER_CODE=$(echo "$ADD_MEMBER_RESPONSE" | tail -1)
  if [[ "$ADD_MEMBER_RC" -ne 0 ]]; then
    warn "Add member request failed (curl exit $ADD_MEMBER_RC)"
  elif [[ "$ADD_MEMBER_CODE" =~ ^(200|201)$ ]]; then
    ok "Add member to group works via HTTP/2"
    [[ -n "${GROUP_ID:-}" ]] && [[ -n "${USER2_ID:-}" ]] && verify_db_after_test 5444 messaging "SELECT 1 FROM messages.group_members WHERE group_id = '${GROUP_ID}' AND user_id = '${USER2_ID}' LIMIT 1" "Test 9c DB: member in messages.group_members" || true
  else
    warn "Add member to group failed - HTTP $ADD_MEMBER_CODE"
    echo "Response body: $(echo "$ADD_MEMBER_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping add member - Group ID not available"
  elif [[ -z "${USER2_ID:-}" ]]; then
    warn "Skipping add member - User 2 ID not available"
  else
    warn "Skipping add member - messaging-service not available or no auth token"
  fi
fi

# Test 9d: Messaging Service - Send Group Message (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9d: Messaging Service - Send Group Message via HTTP/3"
  SEND_GROUP_MSG_RC=0
  SEND_GROUP_MSG_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/messages" \
    -d "{\"group_id\":\"$GROUP_ID\",\"message_type\":\"group\",\"subject\":\"Group Chat Test\",\"content\":\"Hello group! This is a test message via HTTP/3\"}" 2>&1) || SEND_GROUP_MSG_RC=$?
  if [[ "$SEND_GROUP_MSG_RC" -ne 0 ]]; then
    warn "Send group message via HTTP/3 failed (curl exit $SEND_GROUP_MSG_RC)"
  elif [[ -n "$SEND_GROUP_MSG_RESPONSE" ]]; then
    SEND_GROUP_MSG_CODE=$(echo "$SEND_GROUP_MSG_RESPONSE" | tail -1)
    if [[ "$SEND_GROUP_MSG_CODE" =~ ^(200|201)$ ]]; then
      ok "Send group message works via HTTP/3"
    else
      warn "Send group message via HTTP/3 failed - HTTP $SEND_GROUP_MSG_CODE"
      echo "Response body: $(echo "$SEND_GROUP_MSG_RESPONSE" | sed '$d' | head -5)"
    fi
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping group message - Group ID not available"
  else
    warn "Skipping group message - messaging-service not available or no auth token"
  fi
fi

# Test 9e: Messaging Service - Get Group Details (HTTP/2) — strict TLS + resolve; retry up to 2x on curl exit 7 (connection)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9e: Messaging Service - Get Group Details via HTTP/2"
  GET_GROUP_RC=0
  GET_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || GET_GROUP_RC=$?
  _retry=0
  while [[ "$GET_GROUP_RC" -eq 7 ]] && [[ -z "$(echo "$GET_GROUP_RESPONSE" | tail -1 | grep -E '^[0-9]+$')" ]] && [[ "$_retry" -lt 2 ]]; do
    sleep 2
    GET_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || GET_GROUP_RC=$?
    _retry=$((_retry + 1))
  done
  GET_GROUP_CODE=$(echo "$GET_GROUP_RESPONSE" | tail -1)
  if [[ "$GET_GROUP_RC" -ne 0 ]]; then
    warn "Get group details request failed (curl exit $GET_GROUP_RC)"
  elif [[ "$GET_GROUP_CODE" =~ ^(200)$ ]]; then
    ok "Get group details works via HTTP/2"
  else
    warn "Get group details failed - HTTP $GET_GROUP_CODE"
    echo "Response body: $(echo "$GET_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping get group details - Group ID not available"
  else
    warn "Skipping get group details - messaging-service not available or no auth token"
  fi
fi

# Test 9f: Messaging Service - Reply to Group Message (WhatsApp-style) (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9f: Messaging Service - Reply to Group Message via HTTP/2 (WhatsApp-style)"
  # First, get a message ID from the group (from Test 9d)
  # Try to get group messages by querying the group details or messages with group_id filter
  GET_GROUP_MSG_RC=0
  GET_GROUP_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X GET "https://$HOST:${PORT}/api/messages?page=1&limit=50" 2>&1) || GET_GROUP_MSG_RC=$?
  if [[ "$GET_GROUP_MSG_RC" -eq 7 ]]; then
    sleep 2
    GET_GROUP_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages?page=1&limit=50" 2>&1) || GET_GROUP_MSG_RC=$?
  fi
  if [[ "$GET_GROUP_MSG_RC" -eq 0 ]]; then
    GET_GROUP_MSG_CODE=$(echo "$GET_GROUP_MSG_RESPONSE" | tail -1)
    if [[ "$GET_GROUP_MSG_CODE" == "200" ]]; then
      # Try to extract a message ID from the group messages (look for messages with group_id matching GROUP_ID)
      # First try to find a message with group_id in the response
      GROUP_MSG_ID=$(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and 'messages' in data:
        messages = data['messages']
    elif isinstance(data, list):
        messages = data
    else:
        messages = []
    for msg in messages:
        if isinstance(msg, dict) and msg.get('group_id') == '${GROUP_ID}':
            print(msg.get('id', ''))
            break
except:
    pass
" 2>/dev/null || echo "")
      # If not found, try simple grep (fallback) - get any message ID
      if [[ -z "$GROUP_MSG_ID" ]]; then
        GROUP_MSG_ID=$(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
      fi
      # Debug output
      if [[ -z "$GROUP_MSG_ID" ]]; then
        echo "Debug: Could not extract group message ID from response"
        echo "Response preview: $(echo "$GET_GROUP_MSG_RESPONSE" | sed '$d' | head -20)"
      fi
      if [[ -n "$GROUP_MSG_ID" ]]; then
        REPLY_GROUP_MSG_RC=0
        REPLY_GROUP_MSG_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
          --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
          -H "Host: $HOST" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN_USER2" \
          -X POST "https://$HOST:${PORT}/api/messages/$GROUP_MSG_ID/reply" \
          -d '{"message_type":"group","subject":"Re: Group Chat Test","content":"This is a WhatsApp-style reply to the previous message!"}' 2>&1) || REPLY_GROUP_MSG_RC=$?
        REPLY_GROUP_MSG_CODE=$(echo "$REPLY_GROUP_MSG_RESPONSE" | tail -1)
        if [[ "$REPLY_GROUP_MSG_RC" -ne 0 ]]; then
          warn "Reply to group message request failed (curl exit $REPLY_GROUP_MSG_RC)"
        elif [[ "$REPLY_GROUP_MSG_CODE" =~ ^(200|201)$ ]]; then
          ok "Reply to group message works via HTTP/2 (WhatsApp-style)"
          # Check if parent_message is included in response
          if echo "$REPLY_GROUP_MSG_RESPONSE" | sed '$d' | grep -q "parent_message"; then
            ok "Parent message context included in reply response"
          fi
        else
          warn "Reply to group message failed - HTTP $REPLY_GROUP_MSG_CODE"
          echo "Response body: $(echo "$REPLY_GROUP_MSG_RESPONSE" | sed '$d' | head -5)"
        fi
      else
        warn "No group message ID found to reply to"
      fi
    fi
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping reply to group message - Group ID not available"
  else
    warn "Skipping reply to group message - messaging-service not available or no auth token"
  fi
fi

# Test 9g: Messaging Service - Forum Post with upload_type (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]]; then
  say "Test 9g: Messaging Service - Create Forum Post with upload_type via HTTP/2"
  FORUM_POST_UPLOAD_RC=0
  FORUM_POST_UPLOAD_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Test Image Post","content":"This is a test post with upload_type=image","flair":"general","upload_type":"image"}' 2>&1) || FORUM_POST_UPLOAD_RC=$?
  FORUM_POST_UPLOAD_CODE=$(echo "$FORUM_POST_UPLOAD_RESPONSE" | tail -1)
  if [[ "$FORUM_POST_UPLOAD_RC" -ne 0 ]]; then
    warn "Create forum post with upload_type request failed (curl exit $FORUM_POST_UPLOAD_RC)"
  elif [[ "$FORUM_POST_UPLOAD_CODE" =~ ^(200|201)$ ]]; then
    ok "Create forum post with upload_type works via HTTP/2"
    FORUM_POST_UPLOAD_ID=$(echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    # Verify upload_type is in response
    if echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | grep -q '"upload_type":"image"'; then
      ok "upload_type field correctly returned in response"
    fi
  else
    warn "Create forum post with upload_type failed - HTTP $FORUM_POST_UPLOAD_CODE"
    echo "Response body: $(echo "$FORUM_POST_UPLOAD_RESPONSE" | sed '$d' | head -5)"
  fi
else
  warn "Skipping forum post with upload_type - messaging-service not available or no auth token"
fi

# Test 9h: Messaging Service - Add Attachment to Forum Post (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
  say "Test 9h: Messaging Service - Add Attachment to Forum Post via HTTP/2"
  POST_ATTACH_RC=0
  POST_ID="${FORUM_POST_UPLOAD_ID:-$FORUM_POST_ID}"
  POST_ATTACH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$POST_ID/attachments" \
    -d '{"file_url":"https://example.com/test-image.jpg","file_type":"image","file_name":"test-image.jpg","mime_type":"image/jpeg","file_size":12345,"width":1920,"height":1080,"display_order":0}' 2>&1) || POST_ATTACH_RC=$?
  POST_ATTACH_CODE=$(echo "$POST_ATTACH_RESPONSE" | tail -1)
  if [[ "$POST_ATTACH_RC" -ne 0 ]]; then
    warn "Add post attachment request failed (curl exit $POST_ATTACH_RC)"
  elif [[ "$POST_ATTACH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add attachment to forum post works via HTTP/2"
    POST_ATTACH_ID=$(echo "$POST_ATTACH_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Add post attachment failed - HTTP $POST_ATTACH_CODE"
    echo "Response body: $(echo "$POST_ATTACH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
    warn "Skipping add post attachment - Forum post ID not available"
  else
    warn "Skipping add post attachment - messaging-service not available or no auth token"
  fi
fi

# Test 9i: Messaging Service - Add Attachment to Comment (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${FORUM_POST_ID:-}" ]]; then
  say "Test 9i: Messaging Service - Add Comment with Attachment via HTTP/3"
  # First create a comment
  COMMENT_WITH_ATTACH_RC=0
  COMMENT_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/forum/posts/$FORUM_POST_ID/comments" \
    -d '{"content":"This comment will have an attachment"}' 2>&1) || COMMENT_WITH_ATTACH_RC=$?
  if [[ "$COMMENT_WITH_ATTACH_RC" -eq 0 ]] && [[ -n "$COMMENT_RESPONSE" ]]; then
    COMMENT_CODE=$(echo "$COMMENT_RESPONSE" | tail -1)
    if [[ "$COMMENT_CODE" =~ ^(200|201)$ ]]; then
      COMMENT_ID=$(echo "$COMMENT_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
      # Also try JSON parsing as fallback
      if [[ -z "$COMMENT_ID" ]]; then
        COMMENT_ID=$(echo "$COMMENT_RESPONSE" | sed '$d' | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', '') if isinstance(data, dict) else '')" 2>/dev/null || echo "")
      fi
      if [[ -n "$COMMENT_ID" ]] && [[ "$COMMENT_ID" != "placeholder-comment-id" ]]; then
        # Add attachment to comment
        COMMENT_ATTACH_RC=0
        COMMENT_ATTACH_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
          -H "Host: $HOST" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN_USER2" \
          --resolve "$HTTP3_RESOLVE" \
          -X POST "https://$HOST/api/forum/comments/$COMMENT_ID/attachments" \
          -d '{"file_url":"https://example.com/comment-pdf.pdf","file_type":"document","file_name":"document.pdf","mime_type":"application/pdf","file_size":54321,"display_order":0}' 2>&1) || COMMENT_ATTACH_RC=$?
        if [[ "$COMMENT_ATTACH_RC" -eq 0 ]] && [[ -n "$COMMENT_ATTACH_RESPONSE" ]]; then
          COMMENT_ATTACH_CODE=$(echo "$COMMENT_ATTACH_RESPONSE" | tail -1)
          if [[ "$COMMENT_ATTACH_CODE" =~ ^(200|201)$ ]]; then
            ok "Add attachment to comment works via HTTP/3"
          else
            warn "Add comment attachment failed - HTTP $COMMENT_ATTACH_CODE"
            echo "Response body: $(echo "$COMMENT_ATTACH_RESPONSE" | sed '$d' | head -5)"
          fi
        else
          warn "Add comment attachment request failed (curl exit $COMMENT_ATTACH_RC)"
        fi
      else
        warn "Comment ID extraction failed or invalid - COMMENT_ID='${COMMENT_ID}'"
        echo "Comment response: $(echo "$COMMENT_RESPONSE" | sed '$d' | head -10)"
      fi
    else
      warn "Create comment for attachment test failed - HTTP $COMMENT_CODE"
      echo "Response body: $(echo "$COMMENT_RESPONSE" | sed '$d' | head -5)"
    fi
  else
    warn "Create comment for attachment test failed"
  fi
else
  if [[ -z "${FORUM_POST_ID:-}" ]]; then
    warn "Skipping add comment attachment - Forum post ID not available"
  else
    warn "Skipping add comment attachment - messaging-service not available or no auth token"
  fi
fi

# Test 9j: Messaging Service - Add Attachment to Message (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN:-}" ]] && [[ -n "${MESSAGE_ID:-${MESSAGE_H3_ID:-}}" ]]; then
  say "Test 9j: Messaging Service - Add Attachment to Message via HTTP/2"
  MSG_ATTACH_RC=0
  MSG_ID="${MESSAGE_ID:-$MESSAGE_H3_ID}"
  MSG_ATTACH_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/$MSG_ID/attachments" \
    -d '{"file_url":"https://example.com/video.mp4","file_type":"video","file_name":"test-video.mp4","mime_type":"video/mp4","file_size":9876543,"width":1280,"height":720,"duration":120,"display_order":0}' 2>&1) || MSG_ATTACH_RC=$?
  MSG_ATTACH_CODE=$(echo "$MSG_ATTACH_RESPONSE" | tail -1)
  if [[ "$MSG_ATTACH_RC" -ne 0 ]]; then
    warn "Add message attachment request failed (curl exit $MSG_ATTACH_RC)"
  elif [[ "$MSG_ATTACH_CODE" =~ ^(200|201)$ ]]; then
    ok "Add attachment to message works via HTTP/2"
    MSG_ATTACH_ID=$(echo "$MSG_ATTACH_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Add message attachment failed - HTTP $MSG_ATTACH_CODE"
    echo "Response body: $(echo "$MSG_ATTACH_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${MESSAGE_ID:-${MESSAGE_H3_ID:-}}" ]]; then
    warn "Skipping add message attachment - Message ID not available"
  else
    warn "Skipping add message attachment - messaging-service not available or no auth token"
  fi
fi

# Test 9k: Messaging Service - Leave Group Chat (HTTP/2)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${TOKEN_USER2:-}" ]] && [[ -n "${GROUP_ID:-}" ]]; then
  say "Test 9k: Messaging Service - Leave Group Chat via HTTP/2"
  LEAVE_GROUP_RC=0
  LEAVE_GROUP_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X DELETE "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/leave" 2>&1) || LEAVE_GROUP_RC=$?
  LEAVE_GROUP_CODE=$(echo "$LEAVE_GROUP_RESPONSE" | tail -1)
  if [[ "$LEAVE_GROUP_RC" -ne 0 ]]; then
    warn "Leave group request failed (curl exit $LEAVE_GROUP_RC)"
  elif [[ "$LEAVE_GROUP_CODE" =~ ^(204)$ ]]; then
    ok "Leave group chat works via HTTP/2"
    # Verify user is no longer in group by trying to get group details (should fail with 403); use resolve for strict TLS; retry on 000
    VERIFY_LEAVE_RC=0
    VERIFY_LEAVE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN_USER2" \
      -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || VERIFY_LEAVE_RC=$?
    VERIFY_LEAVE_CODE=$(echo "$VERIFY_LEAVE_RESPONSE" | tail -1)
    if [[ "$VERIFY_LEAVE_CODE" == "000" ]] || [[ -z "$VERIFY_LEAVE_CODE" ]]; then
      sleep 2
      VERIFY_LEAVE_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $TOKEN_USER2" \
        -X GET "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || VERIFY_LEAVE_RC=$?
      VERIFY_LEAVE_CODE=$(echo "$VERIFY_LEAVE_RESPONSE" | tail -1)
    fi
    if [[ "$VERIFY_LEAVE_CODE" == "403" ]]; then
      ok "User successfully left group (403 on group access confirms removal)"
    else
      warn "Leave verification unexpected - HTTP $VERIFY_LEAVE_CODE (expected 403)"
    fi
  else
    warn "Leave group failed - HTTP $LEAVE_GROUP_CODE"
    echo "Response body: $(echo "$LEAVE_GROUP_RESPONSE" | sed '$d' | head -5)"
  fi
else
  if [[ -z "${GROUP_ID:-}" ]]; then
    warn "Skipping leave group - Group ID not available"
  else
    warn "Skipping leave group - messaging-service not available or no auth token"
  fi
fi

# Test 9l: Messaging Service - Get Post Attachments (HTTP/3)
if [[ "${SKIP_SOCIAL:-}" != "1" ]] && [[ -n "${FORUM_POST_UPLOAD_ID:-${FORUM_POST_ID:-}}" ]]; then
  say "Test 9l: Messaging Service - Get Post Attachments via HTTP/3"
  GET_POST_ATTACH_RC=0
  POST_ID="${FORUM_POST_UPLOAD_ID:-$FORUM_POST_ID}"
  GET_POST_ATTACH_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer ${TOKEN:-$TOKEN_USER2}" \
    --resolve "$HTTP3_RESOLVE" \
    -X GET "https://$HOST/api/forum/posts/$POST_ID/attachments" 2>&1) || GET_POST_ATTACH_RC=$?
  if [[ "$GET_POST_ATTACH_RC" -eq 0 ]] && [[ -n "$GET_POST_ATTACH_RESPONSE" ]]; then
    GET_POST_ATTACH_CODE=$(echo "$GET_POST_ATTACH_RESPONSE" | tail -1)
    if [[ "$GET_POST_ATTACH_CODE" == "200" ]]; then
      ok "Get post attachments works via HTTP/3"
    else
      warn "Get post attachments failed - HTTP $GET_POST_ATTACH_CODE"
    fi
  else
    warn "Get post attachments request failed (curl exit $GET_POST_ATTACH_RC)"
  fi
else
  warn "Skipping get post attachments - Forum post ID not available"
fi

# Test 14: Auth Service - Logout (HTTP/3 first, then HTTP/2)
if [[ -n "${TOKEN:-}" ]] && type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 14b: Auth Service - Logout via HTTP/3"
  LOGOUT_H3_RC=0
  LOGOUT_H3_RESPONSE=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/auth/logout" 2>&1) || LOGOUT_H3_RC=$?
  LOGOUT_H3_CODE=$(echo "$LOGOUT_H3_RESPONSE" | tail -1)
  if [[ "$LOGOUT_H3_RC" -ne 0 ]]; then
    warn "Logout via HTTP/3 request failed (curl exit $LOGOUT_H3_RC)"
  elif [[ "$LOGOUT_H3_CODE" =~ ^(200|204)$ ]]; then
    ok "Logout works via HTTP/3 (HTTP $LOGOUT_H3_CODE)"
  else
    warn "Logout via HTTP/3 failed - HTTP $LOGOUT_H3_CODE"
  fi
fi

if [[ -n "${TOKEN:-}" ]]; then
  say "Test 14: Auth Service - Logout via HTTP/2"
  LOGOUT_RC=0
  LOGOUT_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/auth/logout" 2>&1) || LOGOUT_RC=$?
  LOGOUT_CODE=$(echo "$LOGOUT_RESPONSE" | tail -1)
  if [[ "$LOGOUT_RC" -ne 0 ]]; then
    warn "Logout request failed (curl exit $LOGOUT_RC)"
  elif [[ "$LOGOUT_CODE" =~ ^(200|204)$ ]]; then
    ok "Logout works via HTTP/2 (HTTP $LOGOUT_CODE)"
  else
    warn "Logout failed - HTTP $LOGOUT_CODE"
  fi
else
  warn "Skipping logout test - no auth token available"
fi

# Test 15: Auth Service - Delete Account via HTTP/2
say "Test 15: Auth Service - Delete Account via HTTP/2"
DELETE_TEST_EMAIL="delete-test-$(date +%s)@example.com"
DELETE_TEST_PASSWORD="test123"
DELETE_REGISTER_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
  -H "Host: $HOST" \
  -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$DELETE_TEST_EMAIL\",\"password\":\"$DELETE_TEST_PASSWORD\"}" 2>&1) || {
  warn "Delete test user registration curl command failed (exit code: $?)"
  DELETE_REGISTER_RESPONSE=""
}
DELETE_REGISTER_CODE=$(echo "$DELETE_REGISTER_RESPONSE" | tail -1)
if [[ "$DELETE_REGISTER_CODE" == "201" ]]; then
  DELETE_TOKEN=$(echo "$DELETE_REGISTER_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  if [[ -n "$DELETE_TOKEN" ]]; then
    ok "Delete test user registered successfully"
    DELETE_ACCOUNT_RC=0
    DELETE_ACCOUNT_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
      --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $DELETE_TOKEN" \
      -X DELETE "https://$HOST:${PORT}/api/auth/account" 2>&1) || DELETE_ACCOUNT_RC=$?
    DELETE_ACCOUNT_CODE=$(echo "$DELETE_ACCOUNT_RESPONSE" | tail -1)
    if [[ "$DELETE_ACCOUNT_RC" -ne 0 ]]; then
      warn "Delete account request failed (curl exit $DELETE_ACCOUNT_RC)"
    elif [[ "$DELETE_ACCOUNT_CODE" == "204" ]]; then
      ok "Delete account works via HTTP/2 (HTTP 204)"
      sleep 1
      DELETE_LOGIN_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" \
        -H "Content-Type: application/json" \
        -X POST "https://$HOST:${PORT}/api/auth/login" \
        -d "{\"email\":\"$DELETE_TEST_EMAIL\",\"password\":\"$DELETE_TEST_PASSWORD\"}" 2>&1)
      DELETE_LOGIN_CODE=$(echo "$DELETE_LOGIN_RESPONSE" | tail -1)
      if [[ "$DELETE_LOGIN_CODE" == "401" ]] || [[ "$DELETE_LOGIN_CODE" == "404" ]]; then
        ok "Account deletion verified (HTTP $DELETE_LOGIN_CODE on login attempt)"
      else
        warn "Account may not be deleted (got HTTP $DELETE_LOGIN_CODE instead of 401/404)"
      fi
      DELETE_VERIFY_RESPONSE=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
        --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $DELETE_TOKEN" \
        -X GET "https://$HOST:${PORT}/api/messages" 2>&1)
      DELETE_VERIFY_CODE=$(echo "$DELETE_VERIFY_RESPONSE" | tail -1)
      if [[ "$DELETE_VERIFY_CODE" == "401" ]]; then
        ok "Token revocation verified after account deletion (401 on protected endpoint)"
      else
        warn "Token may not be revoked after account deletion (got HTTP $DELETE_VERIFY_CODE instead of 401)"
      fi
    else
      warn "Delete account failed - HTTP $DELETE_ACCOUNT_CODE"
    fi
  else
    warn "Delete test user registration succeeded but no token received"
  fi
else
  warn "Delete test user registration failed - HTTP ${DELETE_REGISTER_CODE:-000}"
fi

# Test 15b: Auth Service - Delete Account via HTTP/3
say "Test 15b: Auth Service - Delete Account via HTTP/3"
if type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  DEL_H3_EMAIL="delete-test-h3-$(date +%s)@example.com"
  DEL_H3_PW="test123"
  DEL_H3_REG=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" -H "Content-Type: application/json" --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/auth/register" \
    -d "{\"email\":\"$DEL_H3_EMAIL\",\"password\":\"$DEL_H3_PW\"}" 2>&1) || DEL_H3_REG=""
  DEL_H3_REG_CODE=$(echo "$DEL_H3_REG" | tail -1)
  if [[ "$DEL_H3_REG_CODE" == "201" ]]; then
    DEL_H3_TOKEN=$(echo "$DEL_H3_REG" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ -n "$DEL_H3_TOKEN" ]]; then
      DEL_H3_DEL_RESP=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 30 \
        -H "Host: $HOST" -H "Authorization: Bearer $DEL_H3_TOKEN" --resolve "$HTTP3_RESOLVE" \
        -X DELETE "https://$HOST/api/auth/account" 2>&1) || DEL_H3_DEL_RESP=""
      DEL_H3_DEL_CODE=$(echo "$DEL_H3_DEL_RESP" | tail -1)
      if [[ "$DEL_H3_DEL_CODE" == "204" ]]; then
        ok "Delete account works via HTTP/3 (HTTP 204)"
      else
        warn "Delete account via HTTP/3 failed - HTTP $DEL_H3_DEL_CODE"
      fi
    fi
  else
    info "Test 15b skipped (HTTP/3 register got ${DEL_H3_REG_CODE:-000})"
  fi
else
  info "Test 15b skipped (HTTP/3 not available)"
fi

# Test 16: HTTP/3 health checks for all OCH services
if type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
  say "Test 16: Service Health Checks via HTTP/3"
  for route in \
    "/auth/healthz:Auth Service" \
    "/api/listings/healthz:Listings Service" \
    "/api/booking/healthz:Booking Service" \
    "/api/messaging/healthz:Messaging Service" \
    "/api/trust/healthz:Trust Service" \
    "/api/analytics/healthz:Analytics Service" \
    "/api/media/healthz:Media Service" \
    "/api/healthz:API Gateway"; do
    path="${route%%:*}"
    label="${route#*:}"
    H3_HEALTH=$(strict_http3_curl -sS -w "\n%{http_code}" --http3-only --max-time 15 \
      -H "Host: $HOST" \
      --resolve "$HTTP3_RESOLVE" \
      "https://$HOST${path}" 2>&1) || H3_HEALTH=""
    H3_CODE=$(echo "$H3_HEALTH" | tail -1)
    if [[ "$H3_CODE" == "200" ]]; then
      ok "${label} health via HTTP/3"
    else
      warn "${label} health via HTTP/3 failed - HTTP ${H3_CODE:-000}"
    fi
  done
fi

# Test 17: gRPC health checks for OCH services
say "Test 17: gRPC Health Checks"
if command -v grpcurl >/dev/null 2>&1; then
  grpc_test "auth-service" "auth-service" "50061"
  grpc_test "listings-service" "listings-service" "50062"
  grpc_test "booking-service" "booking-service" "50063"
  grpc_test "messaging-service" "messaging-service" "50064"
  grpc_test "trust-service" "trust-service" "50066"
  grpc_test "analytics-service" "analytics-service" "50067"
  grpc_test "media-service" "media-service" "50068"
else
  warn "grpcurl not installed - skipping gRPC health checks"
fi

# Test 18: Per-service latency probe (HTTP/2 and HTTP/3 health endpoints)
say "Test 18: Per-service latency probe (HTTP/2 + HTTP/3)"
for route in \
  "/auth/healthz:auth" \
  "/api/listings/healthz:listings" \
  "/api/booking/healthz:booking" \
  "/api/messaging/healthz:messaging" \
  "/api/trust/healthz:trust" \
  "/api/analytics/healthz:analytics" \
  "/api/media/healthz:media" \
  "/api/healthz:gateway"; do
  path="${route%%:*}"
  service="${route#*:}"

  H2_LAT=$(strict_curl -sS -o /dev/null -w "%{http_code} %{time_total}" --http2 --max-time 15 \
    --resolve "$HOST:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://$HOST:${PORT}${path}" 2>/dev/null || echo "000 0")
  append_latency_row "$service" "HTTP2" "$(echo "$H2_LAT" | awk '{print $1}')" "$(echo "$H2_LAT" | awk '{print $2}')"

  if type strict_http3_curl &>/dev/null && [[ -n "${HTTP3_RESOLVE:-}" ]]; then
    H3_LAT=$(strict_http3_curl -sS -o /dev/null -w "%{http_code} %{time_total}" --http3-only --max-time 15 \
      -H "Host: $HOST" --resolve "$HTTP3_RESOLVE" "https://$HOST${path}" 2>/dev/null || echo "000 0")
    append_latency_row "$service" "HTTP3" "$(echo "$H3_LAT" | awk '{print $1}')" "$(echo "$H3_LAT" | awk '{print $2}')"
  fi
done

LATENCY_SVG="$LATENCY_DIR/service-latency.svg"
generate_latency_svg_graph "$LATENCY_CSV" "$LATENCY_SVG"
ok "Latency artifacts: $LATENCY_CSV and $LATENCY_SVG"

set -e

# Booking: HTTP/2 + HTTP/3 + edge gRPC (MetalLB) — single entry from preflight via this suite unless skipped
if [[ "${SKIP_BOOKING_IN_HOUSING_SUITE:-0}" != "1" ]]; then
  say "Test 19: Booking service protocol suite (delegates to test-booking-http2-http3.sh)"
  if [[ -x "$SCRIPT_DIR/test-booking-http2-http3.sh" ]]; then
    HOST="${HOST:-off-campus-housing.local}" "$SCRIPT_DIR/test-booking-http2-http3.sh" || fail "Booking protocol suite failed"
  else
    warn "test-booking-http2-http3.sh missing or not executable — skipping"
  fi
else
  info "Test 19 skipped (SKIP_BOOKING_IN_HOUSING_SUITE=1)"
fi

say "=== Housing HTTP/2 + HTTP/3 suite done ==="
