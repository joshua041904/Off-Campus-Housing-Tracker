#!/usr/bin/env bash
# End-to-end smoke: register → DELETE /account → poll auth.auth_outbox until drained.
# Optional: confirm event_id appears in service processed_events when DB URLs are set.
#
# Usage:
#   VERIFY_AUTH_URL=http://127.0.0.1:4001 \
#   POSTGRES_URL_AUTH=postgresql://postgres:postgres@127.0.0.1:5441/auth \
#   ./scripts/verify-deletion-flow.sh
#
# Optional (sample processed_events by event_id from DELETE response):
#   VERIFY_POSTGRES_URL_LISTINGS=postgresql://...@127.0.0.1:5442/listings
#   VERIFY_POSTGRES_URL_BOOKINGS=postgresql://...@127.0.0.1:5443/bookings
#   VERIFY_POSTGRES_URL_MESSAGING=postgresql://...@127.0.0.1:5444/messaging
#   VERIFY_POSTGRES_URL_MEDIA=postgresql://...@127.0.0.1:5448/media
#   VERIFY_POSTGRES_URL_TRUST=postgresql://...@127.0.0.1:5446/trust
#   VERIFY_POSTGRES_URL_NOTIFICATION=postgresql://...@127.0.0.1:5445/notification
#
# Or pass a token (skip register):
#   VERIFY_DELETE_TOKEN='eyJ...' ./scripts/verify-deletion-flow.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

AUTH_BASE="${VERIFY_AUTH_URL:-${ACCOUNT_DELETION_AUTH_BASE_URL:-http://127.0.0.1:4001}}"
AUTH_BASE="${AUTH_BASE%/}"

AUTH_PGURL="${VERIFY_POSTGRES_URL_AUTH:-${POSTGRES_URL_AUTH:-}}"
if [[ -z "$AUTH_PGURL" ]]; then
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT_AUTH:-5441}"
  PGPASSWORD="${PGPASSWORD:-postgres}"
  export PGPASSWORD
  AUTH_PGURL="postgresql://postgres@${PGHOST}:${PGPORT}/auth"
fi

poll_outbox_empty() {
  local max_wait="${VERIFY_OUTBOX_DRAIN_SEC:-120}"
  local interval="${VERIFY_OUTBOX_POLL_SEC:-2}"
  local elapsed=0
  while (( elapsed < max_wait )); do
    local n
    n="$(psql "$AUTH_PGURL" -tAc "SELECT COUNT(*)::text FROM auth.auth_outbox WHERE published_at IS NULL" 2>/dev/null || echo "err")"
    if [[ "$n" == "0" ]]; then
      echo "✅ auth.auth_outbox: no unpublished rows (waited ${elapsed}s)"
      return 0
    fi
    echo "… unpublished outbox rows: ${n} (${elapsed}s / ${max_wait}s)"
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  echo "❌ Timeout: auth.auth_outbox still has unpublished rows after ${max_wait}s"
  psql "$AUTH_PGURL" -c "SELECT id, event_type, topic, created_at, published_at, retry_count FROM auth.auth_outbox WHERE published_at IS NULL ORDER BY created_at DESC LIMIT 10;" || true
  return 1
}

check_processed_sample() {
  local url="$1"
  local schema="$2"
  local event_id="$3"
  [[ -z "$url" || -z "$event_id" ]] && return 0
  local cnt
  cnt="$(psql "$url" -tAc "SELECT COUNT(*)::text FROM ${schema}.processed_events WHERE event_id = '${event_id}'::uuid" 2>/dev/null || echo "0")"
  if [[ "$cnt" =~ ^[1-9] ]]; then
    echo "✅ ${schema}.processed_events contains event_id ${event_id}"
  else
    echo "ℹ️  ${schema}.processed_events: no row for event_id (consumer lag, topic, or URL wrong) count=${cnt}"
  fi
}

if [[ -n "${VERIFY_DELETE_TOKEN:-}" ]]; then
  TOKEN="$VERIFY_DELETE_TOKEN"
  echo "Using VERIFY_DELETE_TOKEN (skip register)"
else
  EMAIL="verify_del_$(date +%s)_${RANDOM}@example.com"
  echo "Registering ${EMAIL} …"
  RESP="$(curl -sS -X POST "${AUTH_BASE}/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"VerifyDel1!zz\",\"sendVerification\":false}")"
  TOKEN="$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)"
  if [[ -z "$TOKEN" ]]; then
    echo "❌ Register failed: $RESP"
    exit 1
  fi
fi

echo "DELETE ${AUTH_BASE}/account …"
HTTP_CODE="$(curl -sS -o /tmp/och_del_account.json -w "%{http_code}" -X DELETE "${AUTH_BASE}/account" \
  -H "Authorization: Bearer ${TOKEN}")"
BODY="$(cat /tmp/och_del_account.json)"
echo "HTTP ${HTTP_CODE} body: ${BODY}"

if [[ "$HTTP_CODE" != "202" ]]; then
  echo "❌ Expected HTTP 202 from DELETE /account"
  exit 1
fi

EVENT_ID="$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('event_id',''))" 2>/dev/null || true)"
if [[ -z "$EVENT_ID" ]]; then
  echo "⚠️  No event_id in response (already_deleted?); outbox poll still runs."
fi

echo "Polling auth DB for drained outbox (POSTGRES) …"
poll_outbox_empty

if [[ -n "$EVENT_ID" ]]; then
  echo "Sampling processed_events for event_id=${EVENT_ID} …"
  check_processed_sample "${VERIFY_POSTGRES_URL_LISTINGS:-}" "listings" "$EVENT_ID"
  check_processed_sample "${VERIFY_POSTGRES_URL_BOOKINGS:-}" "booking" "$EVENT_ID"
  check_processed_sample "${VERIFY_POSTGRES_URL_MESSAGING:-}" "messaging" "$EVENT_ID"
  check_processed_sample "${VERIFY_POSTGRES_URL_MEDIA:-}" "media" "$EVENT_ID"
  check_processed_sample "${VERIFY_POSTGRES_URL_TRUST:-}" "trust" "$EVENT_ID"
  check_processed_sample "${VERIFY_POSTGRES_URL_NOTIFICATION:-}" "notification" "$EVENT_ID"
fi

echo "✅ verify-deletion-flow done"
