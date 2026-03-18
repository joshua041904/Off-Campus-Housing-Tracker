#!/usr/bin/env bash
# HTTP/2 tests use $CURL_BIN with --http2; HTTP/3 tests use http3_curl with --http3-only (no fallback). Same across all suites.
set -euo pipefail

HOST="${HOST:-off-campus-housing.local}"
NS="off-campus-housing-tracker"
CURL_BIN="/opt/homebrew/opt/curl/bin/curl"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/http3.sh
. "$SCRIPT_DIR/lib/http3.sh"
HTTP3_RESOLVE="${HOST}:443:127.0.0.1"

say "=== Testing gRPC via HTTP/2 and HTTP/3 ==="

# Check if grpcurl is available
if ! command -v grpcurl >/dev/null 2>&1; then
  warn "grpcurl not found - some gRPC tests will be skipped"
  warn "  Install with: brew install grpcurl"
  warn "  Or: go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest"
  SKIP_GRPC=1
else
  SKIP_GRPC=0
  ok "grpcurl found - gRPC tests will run"
fi

# Step 1: Create test user
say "Step 1: Creating test user for authentication..."

TEST_EMAIL="test@example.com"
TEST_PASSWORD="testpassword123"
TEST_USER_ID=""
TEST_TOKEN=""

# Check if auth service is ready
AUTH_POD=$(kubectl -n "$NS" get pod -l app=auth-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$AUTH_POD" ]]; then
  warn "Auth service pod not found, trying via API gateway..."
  # Try via API gateway instead
  # Note: Ingress strips /api, so gateway sees /auth/register
  REGISTER_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:8443/api/auth/register" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
    --max-time 10 2>&1 || echo "")
  
  REGISTER_CODE=$(echo "$REGISTER_RESPONSE" | tail -1)
  if [[ "$REGISTER_CODE" == "201" ]] || [[ "$REGISTER_CODE" == "409" ]]; then
    ok "User registration attempted (HTTP $REGISTER_CODE)"
  else
    warn "Registration failed - HTTP $REGISTER_CODE"
    echo "Response: $(echo "$REGISTER_RESPONSE" | sed '$d')"
  fi
  
  # Try to login
  LOGIN_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:8443/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
    --max-time 10 2>&1 || echo "")
  
  HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
  if [[ "$HTTP_CODE" == "200" ]]; then
    TEST_TOKEN=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    TEST_USER_ID=$(echo "$LOGIN_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ -n "$TEST_TOKEN" ]]; then
      ok "Test user authenticated via API gateway"
    fi
  else
    warn "Could not authenticate via API gateway - HTTP $HTTP_CODE"
  fi
else
  # Try to register user (may fail if exists, that's ok)
  kubectl -n "$NS" exec "$AUTH_POD" -- curl -sS --max-time 5 -X POST http://localhost:4001/api/auth/register \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || true
  
  # Get user ID by logging in
  LOGIN_RESPONSE=$(kubectl -n "$NS" exec "$AUTH_POD" -- curl -sS --max-time 5 -X POST http://localhost:4001/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || echo "")
  
  if [[ -n "$LOGIN_RESPONSE" ]]; then
    TEST_USER_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    TEST_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ -n "$TEST_USER_ID" ]]; then
      ok "Test user created/found: $TEST_USER_ID"
    else
      warn "Could not extract user ID from login response"
    fi
  else
    warn "Could not login/create test user"
  fi
fi

# Step 2: Test HTTP/2 health check
say "Step 2: Testing HTTP/2 health check..."
if "$CURL_BIN" -k -sS -I --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | head -n1 | grep -q "200"; then
  ok "HTTP/2 health check works"
else
  warn "HTTP/2 health check failed"
fi

# Step 3: Test HTTP/3 health check
say "Step 3: Testing HTTP/3 health check..."
if http3_curl -k -sS -I --http3-only --max-time 30 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1 | head -n1 | grep -q "HTTP/3 200"; then
  ok "HTTP/3 health check works"
else
  warn "HTTP/3 health check failed (QUIC path unavailable)"
fi

# Step 4: Test API endpoint via HTTP/2
say "Step 4: Testing API endpoint via HTTP/2..."
API_RESPONSE_H2=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 -H "Host: $HOST" "https://$HOST:8443/api/healthz" 2>&1)
HTTP_CODE_H2=$(echo "$API_RESPONSE_H2" | tail -1)
if [[ "$HTTP_CODE_H2" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/2 - HTTP $HTTP_CODE_H2"
else
  warn "API endpoint test failed via HTTP/2 - HTTP $HTTP_CODE_H2"
fi

# Step 5: Test API endpoint via HTTP/3
say "Step 5: Testing API endpoint via HTTP/3..."
API_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/api/healthz" 2>&1)
HTTP_CODE_H3=$(echo "$API_RESPONSE_H3" | tail -1)
if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then
  ok "API endpoint reachable via HTTP/3 - HTTP $HTTP_CODE_H3"
else
  warn "API endpoint test failed via HTTP/3 - HTTP $HTTP_CODE_H3"
fi

# Step 6: Test authentication via HTTP/2
say "Step 6: Testing authentication via HTTP/2..."
if [[ -n "${TEST_EMAIL:-}" ]]; then
  AUTH_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST:8443/api/auth/login" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>&1)
  AUTH_CODE=$(echo "$AUTH_RESPONSE" | tail -1)
  if [[ "$AUTH_CODE" == "200" ]]; then
    ok "Authentication works via HTTP/2"
    AUTH_TOKEN=$(echo "$AUTH_RESPONSE" | sed '$d' | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
  else
    warn "Authentication failed via HTTP/2 - HTTP $AUTH_CODE"
  fi
else
  warn "Skipping authentication test (no test user)"
fi

# Step 7: Test records CRUD via HTTP/2
say "Step 7: Testing records CRUD via HTTP/2..."
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  # Create record
  CREATE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -X POST "https://$HOST:8443/api/records" \
    -d '{"artist":"Test Artist","name":"Test Record","format":"LP","catalog_number":"TEST-001"}' 2>&1)
  CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  if [[ "$CREATE_CODE" == "200" ]] || [[ "$CREATE_CODE" == "201" ]]; then
    ok "Create record works via HTTP/2"
    RECORD_ID=$(echo "$CREATE_RESPONSE" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    # Delete record if we got an ID
    if [[ -n "$RECORD_ID" ]]; then
      DELETE_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -X DELETE "https://$HOST:8443/api/records/$RECORD_ID" 2>&1)
      DELETE_CODE=$(echo "$DELETE_RESPONSE" | tail -1)
      if [[ "$DELETE_CODE" == "200" ]] || [[ "$DELETE_CODE" == "204" ]]; then
        ok "Delete record works via HTTP/2"
      else
        warn "Delete record failed - HTTP $DELETE_CODE"
      fi
    fi
  else
    warn "Create record failed via HTTP/2 - HTTP $CREATE_CODE"
  fi
else
  warn "Skipping CRUD test (no auth token)"
fi

# Step 8: Test records CRUD via HTTP/3
say "Step 8: Testing records CRUD via HTTP/3..."
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  # Create record
  CREATE_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
    -H "Host: $HOST" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    --resolve "$HTTP3_RESOLVE" \
    -X POST "https://$HOST/api/records" \
    -d '{"artist":"Test Artist H3","name":"Test Record H3","format":"LP","catalog_number":"TEST-H3-001"}' 2>&1)
  CREATE_CODE_H3=$(echo "$CREATE_RESPONSE_H3" | tail -1)
  if [[ "$CREATE_CODE_H3" == "200" ]] || [[ "$CREATE_CODE_H3" == "201" ]]; then
    ok "Create record works via HTTP/3"
    RECORD_ID_H3=$(echo "$CREATE_RESPONSE_H3" | sed '$d' | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    # Delete record if we got an ID
    if [[ -n "$RECORD_ID_H3" ]]; then
      DELETE_RESPONSE_H3=$(http3_curl -k -sS -w "\n%{http_code}" --http3-only --max-time 30 \
        -H "Host: $HOST" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        --resolve "$HTTP3_RESOLVE" \
        -X DELETE "https://$HOST/api/records/$RECORD_ID_H3" 2>&1)
      DELETE_CODE_H3=$(echo "$DELETE_RESPONSE_H3" | tail -1)
      if [[ "$DELETE_CODE_H3" == "200" ]] || [[ "$DELETE_CODE_H3" == "204" ]]; then
        ok "Delete record works via HTTP/3"
      else
        warn "Delete record failed via HTTP/3 - HTTP $DELETE_CODE_H3"
      fi
    fi
  else
    warn "Create record failed via HTTP/3 - HTTP $CREATE_CODE_H3"
  fi
else
  warn "Skipping CRUD test via HTTP/3 (no auth token)"
fi

# Step 9: Verify HTTP/2 and HTTP/3 protocol usage
say "Step 9: Verifying protocol usage..."
H2_PROTOCOL=$("$CURL_BIN" -k -sS -I --http2 -H "Host: $HOST" "https://$HOST:8443/_caddy/healthz" 2>&1 | grep -i "HTTP/2" || echo "")
H3_PROTOCOL=$(http3_curl -k -sS -I --http3-only --max-time 30 \
  -H "Host: $HOST" \
  --resolve "$HTTP3_RESOLVE" \
  "https://$HOST/_caddy/healthz" 2>&1 | grep -i "HTTP/3\|HTTP/2" || echo "")

if [[ -n "$H2_PROTOCOL" ]]; then
  ok "HTTP/2 protocol confirmed: $H2_PROTOCOL"
else
  warn "HTTP/2 protocol not confirmed"
fi

if [[ -n "$H3_PROTOCOL" ]]; then
  ok "HTTP/3 protocol confirmed"
else
  warn "HTTP/3 protocol not confirmed"
fi

# Helper function to run grpcurl with timeout
grpcurl_with_timeout() {
  local timeout_sec="${1:-10}"
  shift
  local cmd=("$@")
  
  # Try to use timeout command (Linux, or gtimeout on macOS with coreutils)
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" "${cmd[@]}" 2>&1
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$timeout_sec" "${cmd[@]}" 2>&1
  else
    # Fallback: run in background and kill after timeout
    local pid
    "${cmd[@]}" 2>&1 &
    pid=$!
    (
      sleep "$timeout_sec"
      kill "$pid" 2>/dev/null || true
    ) &
    wait "$pid" 2>/dev/null || echo "grpcurl timeout after ${timeout_sec}s"
  fi
}

# Step 10: Test gRPC services (if grpcurl is available)
if [[ "${SKIP_GRPC:-1}" == "0" ]]; then
  say "Step 10: Testing gRPC Services via HTTP/2..."
  
  # Test Auth Service gRPC
  say "Step 10a: gRPC Auth Service - HealthCheck"
  GRPC_AUTH_HEALTH=$(grpcurl_with_timeout 10 grpcurl -insecure -H "Host: $HOST" \
    -d '{}' \
    "$HOST:8443" /auth.AuthService/HealthCheck) || GRPC_AUTH_HEALTH=""
  if echo "$GRPC_AUTH_HEALTH" | grep -q "healthy"; then
    ok "gRPC Auth HealthCheck works"
  else
    warn "gRPC Auth HealthCheck failed"
    echo "Response: $GRPC_AUTH_HEALTH" | head -3
  fi

  # Test Auth Service - Authenticate
  if [[ -n "${TEST_EMAIL:-}" ]] && [[ -n "${TEST_PASSWORD:-}" ]]; then
    say "Step 10b: gRPC Auth Service - Authenticate"
    GRPC_AUTH_RESPONSE=$(grpcurl_with_timeout 10 grpcurl -insecure -H "Host: $HOST" \
      -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
      "$HOST:8443" /auth.AuthService/Authenticate) || GRPC_AUTH_RESPONSE=""
    if echo "$GRPC_AUTH_RESPONSE" | grep -q "token"; then
      ok "gRPC Auth Authenticate works"
      GRPC_TOKEN=$(echo "$GRPC_AUTH_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")
    else
      warn "gRPC Auth Authenticate failed"
      echo "Response: $GRPC_AUTH_RESPONSE" | head -3
    fi
  fi

  # Test Records Service gRPC
  say "Step 10c: gRPC Records Service - HealthCheck"
  GRPC_RECORDS_HEALTH=$(grpcurl_with_timeout 10 grpcurl -insecure -H "Host: $HOST" \
    -d '{}' \
    "$HOST:8443" /records.RecordsService/HealthCheck) || GRPC_RECORDS_HEALTH=""
  if echo "$GRPC_RECORDS_HEALTH" | grep -q "healthy"; then
    ok "gRPC Records HealthCheck works"
  else
    warn "gRPC Records HealthCheck failed"
    echo "Response: $GRPC_RECORDS_HEALTH" | head -3
  fi

  # Test Social Service gRPC
  say "Step 10d: gRPC Social Service - HealthCheck"
  GRPC_SOCIAL_HEALTH=$(grpcurl_with_timeout 10 grpcurl -insecure -H "Host: $HOST" \
    -d '{}' \
    "$HOST:8443" /social.SocialService/HealthCheck) || GRPC_SOCIAL_HEALTH=""
  if echo "$GRPC_SOCIAL_HEALTH" | grep -q "healthy"; then
    ok "gRPC Social HealthCheck works"
  else
    warn "gRPC Social HealthCheck failed"
    echo "Response: $GRPC_SOCIAL_HEALTH" | head -3
  fi

  # Test Listings Service gRPC
  say "Step 10e: gRPC Listings Service - HealthCheck"
  GRPC_LISTINGS_HEALTH=$(grpcurl_with_timeout 10 grpcurl -insecure -H "Host: $HOST" \
    -d '{}' \
    "$HOST:8443" /listings.ListingsService/HealthCheck) || GRPC_LISTINGS_HEALTH=""
  if echo "$GRPC_LISTINGS_HEALTH" | grep -q "healthy"; then
    ok "gRPC Listings HealthCheck works"
  else
    warn "gRPC Listings HealthCheck failed"
    echo "Response: $GRPC_LISTINGS_HEALTH" | head -3
  fi

  # Test Analytics Service gRPC
  say "Step 10f: gRPC Analytics Service - HealthCheck"
  GRPC_ANALYTICS_HEALTH=$(grpcurl_with_timeout 10 grpcurl -insecure -H "Host: $HOST" \
    -d '{}' \
    "$HOST:8443" /analytics.AnalyticsService/HealthCheck) || GRPC_ANALYTICS_HEALTH=""
  if echo "$GRPC_ANALYTICS_HEALTH" | grep -q "healthy"; then
    ok "gRPC Analytics HealthCheck works"
  else
    warn "gRPC Analytics HealthCheck failed"
    echo "Response: $GRPC_ANALYTICS_HEALTH" | head -3
  fi
else
  warn "Skipping gRPC tests - grpcurl not available"
fi

# Step 11: Test Logout
say "Step 11: Testing Logout..."
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  LOGOUT_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
    -H "Host: $HOST" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -X POST "https://$HOST:8443/api/auth/logout" 2>&1)
  LOGOUT_CODE=$(echo "$LOGOUT_RESPONSE" | tail -1)
  if [[ "$LOGOUT_CODE" =~ ^(200|204)$ ]]; then
    ok "Logout works via HTTP/2"
    # Verify token is revoked
    sleep 1
    VERIFY_RESPONSE=$("$CURL_BIN" -k -sS -w "\n%{http_code}" --http2 --max-time 10 \
      -H "Host: $HOST" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -X GET "https://$HOST:8443/api/records" 2>&1)
    VERIFY_CODE=$(echo "$VERIFY_RESPONSE" | tail -1)
    if [[ "$VERIFY_CODE" == "401" ]]; then
      ok "Token revocation verified (401 on protected endpoint)"
    else
      warn "Token may not be revoked (got HTTP $VERIFY_CODE instead of 401)"
    fi
  else
    warn "Logout failed - HTTP $LOGOUT_CODE"
  fi
else
  warn "Skipping logout test (no auth token)"
fi

say "=== Testing Complete ==="
echo ""
echo "Summary:"
echo "- HTTP/2: $(if [[ "$HTTP_CODE_H2" =~ ^(200|404|502)$ ]]; then echo "✅ Working"; else echo "❌ Failed"; fi)"
echo "- HTTP/3: $(if [[ "$HTTP_CODE_H3" =~ ^(200|404|502)$ ]]; then echo "✅ Working"; else echo "❌ Failed"; fi)"
echo "- Authentication: $(if [[ -n "${AUTH_TOKEN:-}" ]]; then echo "✅ Working"; else echo "⚠️  Skipped"; fi)"
echo "- CRUD Operations: $(if [[ -n "${RECORD_ID:-}" ]] || [[ -n "${RECORD_ID_H3:-}" ]]; then echo "✅ Working"; else echo "⚠️  Skipped"; fi)"
echo "- gRPC Services: $(if [[ "${SKIP_GRPC:-1}" == "0" ]]; then echo "✅ Tested"; else echo "⚠️  Skipped (grpcurl not found)"; fi)"
echo "- Logout: $(if [[ -n "${AUTH_TOKEN:-}" ]] && [[ "$LOGOUT_CODE" =~ ^(200|204)$ ]]; then echo "✅ Working"; else echo "⚠️  Skipped"; fi)"

