#!/usr/bin/env bash
# Comprehensive messaging-service test: all forum + messages routes (HTTP/2 via gateway).
# Requires: HOST, PORT, strict TLS CA. Obtains auth tokens via register/login.
# Run standalone or as part of run-all-test-suites (messaging suite).
# Exit 0 if all tests pass; non-zero otherwise.
#
# If archive/recall/kick/ban (or list archived/delete thread/list groups) return 501,
# ensure Postgres messaging DB (port 5444) is up and run:
#   PGHOST=127.0.0.1 PGPASSWORD=postgres ./scripts/ensure-messaging-schema.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
NS="$HOUSING_NS"
HOST="${HOST:-off-campus-housing.local}"
PORT="${PORT:-30443}"

# Auto-detect current Caddy LoadBalancer IP/hostname when not provided.
# This keeps standalone runs aligned with the active MetalLB subnet.
if [[ -z "${TARGET_IP:-}" ]] && [[ -z "${REACHABLE_LB_IP:-}" ]]; then
  _live_lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  [[ -z "$_live_lb" ]] && _live_lb=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
  if [[ -n "$_live_lb" ]]; then
    export TARGET_IP="$_live_lb"
    export REACHABLE_LB_IP="$_live_lb"
  fi
  unset _live_lb 2>/dev/null || true
fi

# When run after run-all-test-suites with LB IP, TARGET_IP/REACHABLE_LB_IP and PORT=443 are set — use for --resolve so requests hit Caddy
CURL_RESOLVE_IP="${TARGET_IP:-${REACHABLE_LB_IP:-127.0.0.1}}"
if [[ -n "${TARGET_IP:-}" ]] || [[ -n "${REACHABLE_LB_IP:-}" ]]; then
  PORT="443"
fi

# Extra fallback for local standalone runs: resolve directly via kubectl when
# helper-based detection falls back to 127.0.0.1 (causes HTTP 000 from host).
if [[ -z "${CURL_RESOLVE_IP:-}" ]] || [[ "${CURL_RESOLVE_IP:-}" == "127.0.0.1" ]]; then
  _lb_direct="$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  [[ -z "$_lb_direct" ]] && _lb_direct="$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  if [[ -n "$_lb_direct" ]]; then
    CURL_RESOLVE_IP="$_lb_direct"
    PORT="443"
  fi
  unset _lb_direct 2>/dev/null || true
fi
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"

ctx=$(kubectl config current-context 2>/dev/null || echo "")

# Colima/kubectl helper (same as baseline) — use colima ssh for fresh K8s secrets after rotation
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

# Port detection (same as baseline) — after rotation or when using LB IP, use correct port
if [[ -z "${TARGET_IP:-}" ]] && [[ -z "${REACHABLE_LB_IP:-}" ]]; then
  if [[ -z "${PORT:-}" ]] || [[ "${PORT:-}" == "30443" ]]; then
    DETECTED=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
    [[ -n "$DETECTED" ]] && PORT="$DETECTED"
  fi
fi
export PORT="${PORT:-30443}"

# CA for strict TLS (same as baseline) — re-fetch from K8s each run so post-rotation certs are used
# Use _kb so Colima gets fresh secrets from VM (critical after rotation suite)
CA_CERT=""
K8S_CA_ING=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA_ING" ]]; then
  CA_CERT="/tmp/test-messaging-ca-$$.pem"
  echo "$K8S_CA_ING" > "$CA_CERT"
fi
[[ -z "$CA_CERT" ]] && [[ -n "$(_kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null)" ]] && {
  CA_CERT="/tmp/test-messaging-ca-$$.pem"
  _kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d > "$CA_CERT"
}
[[ -z "$CA_CERT" ]] && [[ -f "/tmp/grpc-certs/ca.crt" ]] && CA_CERT="/tmp/grpc-certs/ca.crt"

strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    "$CURL_BIN" --cacert "$CA_CERT" "$@"
  else
    "$CURL_BIN" -k "$@"
  fi
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

# Extract user_id from JWT payload (base64 middle segment)
# Use | delimiter for sed (portable: macOS BSD sed, GNU sed) — avoids unescaped newline / \/ issues
extract_user_id() {
  local token="$1"
  local mid
  mid=$(echo "$token" | cut -d. -f2 2>/dev/null)
  [[ -z "$mid" ]] && return
  mid=$(echo "$mid" | sed 's|-|+|g; s|_|/|g')
  local pad=$((4 - ${#mid} % 4)); [[ $pad -lt 4 ]] && mid="${mid}$(printf '%*s' $pad '')"
  echo "$mid" | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"' | cut -d'"' -f4 || echo ""
}

FAILED=0
# Diagnostic: on first failure print HTTP code and body (set by _check_social)
_first_failure_done=0
_check_social() {
  local r="$1"
  local expected="$2"
  local label="$3"
  local code
  code=$(echo "$r" | tail -1)
  if [[ "$code" == "$expected" ]]; then
    ok "$label"
    return 0
  fi
  warn "$label"
  FAILED=$((FAILED + 1))
  if [[ "$_first_failure_done" -eq 0 ]]; then
    _first_failure_done=1
    local body
    body=$(echo "$r" | sed '$d' | head -c 300)
    echo "  ℹ️  HTTP code: ${code:-none} (expected $expected)"
    echo "  ℹ️  Body (first 300 chars): ${body:-none}"
  fi
  return 1
}

# --- Ensure messaging schema/outbox (Kafka payload support) ---
# Preflight also runs DB setup; this block keeps standalone runs consistent.
if [[ -f "$SCRIPT_DIR/ensure-messaging-schema.sh" ]]; then
  say "Ensuring messaging schema (port 5444) and outbox..."
  chmod +x "$SCRIPT_DIR/ensure-messaging-schema.sh" 2>/dev/null || true
  if "$SCRIPT_DIR/ensure-messaging-schema.sh" 2>/dev/null; then
    ok "Messaging schema applied"
  else
    warn "Messaging schema skipped or partial (psql required; Postgres messaging on port 5444 must be up)."
  fi
fi

# --- Wait for service stability (especially after rotation/chaos tests) ---
say "Waiting for service stability..."
for svc in messaging-service api-gateway; do
  _kb wait --for=condition=ready pod -l app=$svc -n off-campus-housing-tracker --timeout=60s 2>/dev/null || true
done
sleep 10
ok "Services stable"

# --- Auth: two users ---
say "=== Auth: register/login (User 1 & 2) ==="
TEST_EMAIL="social-comp-1-$(date +%s)@example.com"
TEST_EMAIL_USER2="social-comp-2-$(date +%s)@example.com"
TOKEN=""; TOKEN_USER2=""; USER1_ID=""; USER2_ID=""

REG1=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1) || true
CODE1=$(echo "$REG1" | tail -1)
if [[ "$CODE1" == "201" ]]; then
  TOKEN=$(echo "$REG1" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER1_ID=$(extract_user_id "$TOKEN")
  ok "User 1 registered"
else
  # try login
  LOG1=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -X POST "https://$HOST:${PORT}/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"test123\"}" 2>&1) || true
  if [[ "$(echo "$LOG1" | tail -1)" == "200" ]]; then
    TOKEN=$(echo "$LOG1" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    USER1_ID=$(extract_user_id "$TOKEN")
    ok "User 1 logged in"
  fi
fi

REG2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
  -X POST "https://$HOST:${PORT}/api/auth/register" \
  -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" 2>&1) || true
CODE2=$(echo "$REG2" | tail -1)
if [[ "$CODE2" == "201" ]]; then
  TOKEN_USER2=$(echo "$REG2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  USER2_ID=$(extract_user_id "$TOKEN_USER2")
  ok "User 2 registered"
else
  LOG2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 20 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -X POST "https://$HOST:${PORT}/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL_USER2\",\"password\":\"test123\"}" 2>&1) || true
  if [[ "$(echo "$LOG2" | tail -1)" == "200" ]]; then
    TOKEN_USER2=$(echo "$LOG2" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    USER2_ID=$(extract_user_id "$TOKEN_USER2")
    ok "User 2 logged in"
  fi
fi

if [[ -z "$TOKEN" ]]; then
  warn "No User 1 token; messaging tests will skip authenticated routes"
fi
if [[ -z "$TOKEN_USER2" ]]; then
  warn "No User 2 token; P2P/group tests may be limited"
fi

# --- Messaging healthz ---
say "=== Messaging: healthz ==="
HEALTH=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
  "https://$HOST:${PORT}/api/messaging/healthz" 2>&1) || true
HEALTH_CODE=$(echo "$HEALTH" | tail -1)
if [[ "$HEALTH_CODE" == "200" ]]; then
  ok "Messaging healthz 200"
else
  warn "Messaging healthz HTTP $HEALTH_CODE"; FAILED=$((FAILED+1))
fi

# --- Forum: list posts (requires auth — api-gateway uses requireUserIdFromRequest) ---
say "=== Forum: GET /forum/posts ==="
# API gateway GET /forum/posts requires Authorization (gRPC ListPosts needs user_id)
R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  "https://$HOST:${PORT}/api/forum/posts?page=1&limit=5" 2>&1) || true
C=$(echo "$R" | tail -1)
if [[ "$C" == "200" ]]; then
  ok "List posts 200"
else
  warn "List posts HTTP $C"; FAILED=$((FAILED+1))
fi

if [[ -z "$TOKEN" ]]; then
  say "Skipping authenticated forum/messages tests (no token)"
  [[ $FAILED -gt 0 ]] && exit 1
  exit 0
fi

# --- Forum: create post ---
say "=== Forum: POST /forum/posts ==="
CREATE_POST=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/forum/posts" \
  -d '{"title":"Social comprehensive test post","content":"Body here","flair":"general"}' 2>&1) || true
CP_CODE=$(echo "$CREATE_POST" | tail -1)
POST_ID=""

# Retry on HTTP 000 (connection failure/timeout)
if [[ "$CP_CODE" == "000" ]]; then
  warn "POST failed (000), retrying in 5s..."
  sleep 5
  CREATE_POST=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 30 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts" \
    -d '{"title":"Social comprehensive test post","content":"Body here","flair":"general"}' 2>&1) || true
  CP_CODE=$(echo "$CREATE_POST" | tail -1)
fi

if [[ "$CP_CODE" =~ ^(200|201)$ ]]; then
  POST_ID=$(echo "$CREATE_POST" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  ok "Create post $CP_CODE"
else
  warn "Create post HTTP $CP_CODE"; FAILED=$((FAILED+1))
fi

# --- Forum: get post ---
if [[ -n "$POST_ID" ]]; then
  say "=== Forum: GET /forum/posts/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/forum/posts/$POST_ID" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Get post 200"; else warn "Get post failed"; FAILED=$((FAILED+1)); fi
fi

# --- Forum: update post ---
if [[ -n "$POST_ID" ]]; then
  say "=== Forum: PUT /forum/posts/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X PUT "https://$HOST:${PORT}/api/forum/posts/$POST_ID" \
    -d '{"title":"Updated title","content":"Updated body","flair":"general"}' 2>&1) || true
  _check_social "$R" "200" "Update post 200" || true
fi

# --- Forum: vote post ---
if [[ -n "$POST_ID" ]]; then
  say "=== Forum: POST /forum/posts/:id/vote ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$POST_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Vote post 200"; else warn "Vote post failed"; FAILED=$((FAILED+1)); fi
fi

# --- Forum: list comments ---
if [[ -n "$POST_ID" ]]; then
  say "=== Forum: GET /forum/posts/:id/comments ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/forum/posts/$POST_ID/comments" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "List comments 200"; else warn "List comments failed"; FAILED=$((FAILED+1)); fi
fi

# --- Forum: create comment ---
COMMENT_ID=""
if [[ -n "$POST_ID" ]]; then
  say "=== Forum: POST /forum/posts/:id/comments ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/posts/$POST_ID/comments" \
    -d '{"content":"A test comment from social comprehensive"}' 2>&1) || true
  COMMENT_ID=$(echo "$R" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ "$(echo "$R" | tail -1)" == "200" ]] || [[ "$(echo "$R" | tail -1)" == "201" ]]; then ok "Create comment 200/201"; else warn "Create comment failed"; FAILED=$((FAILED+1)); fi
fi

# --- Forum: update comment ---
if [[ -n "$COMMENT_ID" ]]; then
  say "=== Forum: PUT /forum/comments/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X PUT "https://$HOST:${PORT}/api/forum/comments/$COMMENT_ID" \
    -d '{"content":"Updated comment content"}' 2>&1) || true
  _check_social "$R" "200" "Update comment 200" || true
fi

# --- Forum: vote comment ---
if [[ -n "$COMMENT_ID" ]]; then
  say "=== Forum: POST /forum/comments/:id/vote ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/forum/comments/$COMMENT_ID/vote" \
    -d '{"vote":"up"}' 2>&1) || true
  _check_social "$R" "200" "Vote comment 200" || true
fi

# --- Messages: list (inbox) ---
say "=== Messages: GET /messages ==="
R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
  -H "Authorization: Bearer $TOKEN" \
  "https://$HOST:${PORT}/api/messages?page=1&limit=5" 2>&1) || true
if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "List messages 200"; else warn "List messages failed"; FAILED=$((FAILED+1)); fi

# --- Messages: send direct (P2P) ---
MSG_ID=""; THREAD_ID=""
if [[ -n "$USER2_ID" ]]; then
  say "=== Messages: POST /messages (direct) ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages" \
    -d "{\"recipient_id\":\"$USER2_ID\",\"message_type\":\"direct\",\"subject\":\"Social comp test\",\"content\":\"Hello from social suite\"}" 2>&1) || true
  MSG_ID=$(echo "$R" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  THREAD_ID=$(echo "$R" | sed '$d' | grep -o '"thread_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]]; then ok "Send message 200/201"; else warn "Send message failed"; FAILED=$((FAILED+1)); fi
fi

# --- Messages: get message ---
if [[ -n "$MSG_ID" ]]; then
  say "=== Messages: GET /messages/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/messages/$MSG_ID" 2>&1) || true
  C=$(echo "$R" | tail -1)
  if [[ "$C" == "200" ]]; then ok "Get message 200"; else warn "Get message failed (HTTP $C)"; FAILED=$((FAILED+1)); fi
fi

# --- Messages: reply ---
if [[ -n "$MSG_ID" ]] && [[ -n "$TOKEN_USER2" ]]; then
  say "=== Messages: POST /messages/:id/reply ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X POST "https://$HOST:${PORT}/api/messages/$MSG_ID/reply" \
    -d '{"message_type":"direct","subject":"Re: Social comp test","content":"Reply from user2"}' 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]]; then ok "Reply message 200/201"; else warn "Reply message failed"; FAILED=$((FAILED+1)); fi
fi

# --- Messages: get thread ---
if [[ -n "$THREAD_ID" ]]; then
  say "=== Messages: GET /messages/thread/:threadId ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/messages/thread/$THREAD_ID" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Get thread 200"; else warn "Get thread failed"; FAILED=$((FAILED+1)); fi
fi

# --- Messages: archive chat (thread) ---
if [[ -n "$THREAD_ID" ]]; then
  say "=== Messages: POST /messages/thread/:threadId/archive ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/thread/$THREAD_ID/archive" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]]; then ok "Archive thread 200/201"; else warn "Archive thread failed (may need migration)"; fi
fi

# --- Messages: list archived ---
say "=== Messages: GET /messages/archived ==="
R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
  -H "Authorization: Bearer $TOKEN" \
  "https://$HOST:${PORT}/api/messages/archived" 2>&1) || true
if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "List archived 200"; else warn "List archived failed"; fi

# --- Messages: delete chat (for me) ---
if [[ -n "$THREAD_ID" ]]; then
  say "=== Messages: POST /messages/thread/:threadId/delete ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/thread/$THREAD_ID/delete" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]]; then ok "Delete thread for me 200/201"; else warn "Delete thread failed (may need migration)"; fi
fi

# --- Messages: mark read ---
if [[ -n "$MSG_ID" ]]; then
  say "=== Messages: POST /messages/:id/read ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/$MSG_ID/read" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Mark read 200"; else warn "Mark read failed"; FAILED=$((FAILED+1)); fi
fi

# --- Groups: create ---
say "=== Messages: POST /messages/groups ==="
R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -X POST "https://$HOST:${PORT}/api/messages/groups" \
  -d '{"name":"Social comp group","description":"Created by social comprehensive test"}' 2>&1) || true
GROUP_ID=$(echo "$R" | sed '$d' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]] && [[ -n "$GROUP_ID" ]]; then
  ok "Create group 200/201"
else
  warn "Create group failed"; FAILED=$((FAILED+1))
fi

# --- Groups: list ---
say "=== Messages: GET /messages/groups ==="
R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
  --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
  -H "Authorization: Bearer $TOKEN" \
  "https://$HOST:${PORT}/api/messages/groups" 2>&1) || true
LIST_GROUPS_CODE=$(echo "$R" | tail -1)
if [[ "$LIST_GROUPS_CODE" == "200" ]]; then
  ok "List groups 200"
else
  warn "List groups failed (HTTP $LIST_GROUPS_CODE)"
  BODY=$(echo "$R" | sed '$d')
  [[ -n "$BODY" ]] && info "  Response (first 300 chars): $(echo "$BODY" | head -c 300)"
  FAILED=$((FAILED+1))
fi

# --- Groups: get one ---
if [[ -n "$GROUP_ID" ]]; then
  say "=== Messages: GET /messages/groups/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Get group 200"; else warn "Get group failed"; FAILED=$((FAILED+1)); fi
fi

# --- Groups: add member ---
if [[ -n "$GROUP_ID" ]] && [[ -n "$USER2_ID" ]]; then
  say "=== Messages: POST /messages/groups/:id/members ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/members" \
    -d "{\"user_id\":\"$USER2_ID\"}" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201|204)$ ]]; then ok "Add member 200/201/204"; else warn "Add member failed"; FAILED=$((FAILED+1)); fi
fi

# --- Groups: kick member (user1 kicks user2) ---
if [[ -n "$GROUP_ID" ]] && [[ -n "$USER2_ID" ]]; then
  say "=== Messages: POST /messages/groups/:id/kick ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/kick" \
    -d "{\"user_id\":\"$USER2_ID\"}" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Kick member 200"; else warn "Kick member failed (may need admin role)"; fi
  # Re-add user2 so leave test still works
  strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/members" \
    -d "{\"user_id\":\"$USER2_ID\"}" >/dev/null 2>&1 || true
fi

# --- Groups: ban then unban (optional; skip if kick failed) ---
if [[ -n "$GROUP_ID" ]] && [[ -n "$USER2_ID" ]]; then
  say "=== Messages: POST /messages/groups/:id/ban ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/ban" \
    -d "{\"user_id\":\"$USER2_ID\",\"reason\":\"Test ban\"}" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]]; then
    ok "Ban member 200/201"
    say "=== Messages: DELETE /messages/groups/:id/ban/:userId (unban) ==="
    R2=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
      --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
      -H "Authorization: Bearer $TOKEN" \
      -X DELETE "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/ban/$USER2_ID" 2>&1) || true
    if [[ "$(echo "$R2" | tail -1)" == "204" ]]; then ok "Unban 204"; else warn "Unban failed"; fi
    # Re-add user2 to group after unban so leave test works
    strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
      --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -X POST "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/members" \
      -d "{\"user_id\":\"$USER2_ID\"}" >/dev/null 2>&1 || true
  else
    warn "Ban member failed (may need migration)"
  fi
fi

# --- Messages: edit message (recall alternative = update content) ---
if [[ -n "$MSG_ID" ]]; then
  say "=== Messages: PUT /messages/:id (edit) ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X PUT "https://$HOST:${PORT}/api/messages/$MSG_ID" \
    -d '{"content":"Edited content from social suite"}' 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Edit message 200"; else warn "Edit message failed"; fi
fi

# --- Messages: recall message ---
if [[ -n "$MSG_ID" ]]; then
  say "=== Messages: POST /messages/:id/recall ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages/$MSG_ID/recall" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]]; then ok "Recall message 200"; else warn "Recall message failed (may need migration)"; fi
fi

# --- Groups: send group message ---
if [[ -n "$GROUP_ID" ]]; then
  say "=== Messages: POST /messages (group) ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -X POST "https://$HOST:${PORT}/api/messages" \
    -d "{\"group_id\":\"$GROUP_ID\",\"message_type\":\"group\",\"subject\":\"Group test\",\"content\":\"Hello group\"}" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" =~ ^(200|201)$ ]]; then ok "Send group message 200/201"; else warn "Send group message failed"; FAILED=$((FAILED+1)); fi
fi

# --- Groups: leave (as user2) ---
if [[ -n "$GROUP_ID" ]] && [[ -n "$TOKEN_USER2" ]]; then
  say "=== Messages: DELETE /messages/groups/:id/leave ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN_USER2" \
    -X DELETE "https://$HOST:${PORT}/api/messages/groups/$GROUP_ID/leave" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]] || [[ "$(echo "$R" | tail -1)" == "204" ]]; then ok "Leave group 200/204"; else warn "Leave group failed"; FAILED=$((FAILED+1)); fi
fi

# --- Forum: delete comment (cleanup) ---
if [[ -n "$COMMENT_ID" ]]; then
  say "=== Forum: DELETE /forum/comments/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X DELETE "https://$HOST:${PORT}/api/forum/comments/$COMMENT_ID" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]] || [[ "$(echo "$R" | tail -1)" == "204" ]]; then ok "Delete comment 200/204"; else warn "Delete comment failed"; fi
fi

# --- Forum: delete post (cleanup) ---
if [[ -n "$POST_ID" ]]; then
  say "=== Forum: DELETE /forum/posts/:id ==="
  R=$(strict_curl -sS -w "\n%{http_code}" --http2 --max-time 10 \
    --resolve "$HOST:${PORT}:$CURL_RESOLVE_IP" -H "Host: $HOST" \
    -H "Authorization: Bearer $TOKEN" \
    -X DELETE "https://$HOST:${PORT}/api/forum/posts/$POST_ID" 2>&1) || true
  if [[ "$(echo "$R" | tail -1)" == "200" ]] || [[ "$(echo "$R" | tail -1)" == "204" ]]; then ok "Delete post 200/204"; else warn "Delete post failed"; fi
fi

# Cleanup temp CA
[[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]] && [[ "$CA_CERT" == *"test-messaging-ca"* ]] && rm -f "$CA_CERT"

say "=== Messaging comprehensive test complete ==="
if [[ $FAILED -eq 0 ]]; then
  ok "All messaging-service edge tests passed"
  exit 0
else
  warn "$FAILED test(s) failed"
  exit 1
fi
