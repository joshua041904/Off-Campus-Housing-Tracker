#!/usr/bin/env bash
# k6 → https://off-campus-housing.test → Caddy → HAProxy → api-gateway (strict TLS, hostname only).
# Tests only through the edge domain. No port-forward, no localhost gateway, no insecure skip.
#
# Requirements:
#   - BASE_URL must be https (default https://off-campus-housing.test)
#   - SSL_CERT_FILE must be a non-empty file (default REPO_ROOT/certs/dev-root.pem)
#   - K6_INSECURE_SKIP_TLS is forced to 0
#   - Hostname must resolve (e.g. /etc/hosts: <external IP> off-campus-housing.test)
#
# Env:
#   SKIP_K6_GRID=1           — no-op
#   K6_SMOKE_DURATION        — default 22s per script (health grid)
#   K6_SMOKE_VUS             — default 5
#   SKIP_K6_BOOKING_SEARCH=1 — skip k6-booking.js + k6-search-watchlist.js
#   SKIP_K6_ANALYTICS_LISTING_FEEL=1 — skip Ollama-backed POST listing-feel
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOAD="$SCRIPT_DIR/load"

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

[[ "${SKIP_K6_GRID:-0}" == "1" ]] && { echo "SKIP_K6_GRID=1 — skipping"; exit 0; }

command -v k6 >/dev/null 2>&1 || { echo "k6 not installed"; exit 1; }

export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
export K6_INSECURE_SKIP_TLS=0

BASE_URL="$(edge_normalize_k6_base_url)" || exit 1
export BASE_URL
edge_require_host_resolves "$BASE_URL" || exit 1

CA="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export SSL_CERT_FILE="$CA"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$CA}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$CA}"

if [[ ! -s "$SSL_CERT_FILE" ]]; then
  echo "SSL_CERT_FILE missing or empty: $SSL_CERT_FILE"
  exit 1
fi

DUR="${K6_SMOKE_DURATION:-22s}"
VUS="${K6_SMOKE_VUS:-5}"

_k6_run() {
  k6 run \
    -e "BASE_URL=${BASE_URL}" \
    -e "K6_TLS_CA_CERT=${K6_TLS_CA_CERT}" \
    -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE}" \
    -e "K6_INSECURE_SKIP_TLS=0" \
    -e "DURATION=${DURATION:-}" \
    -e "VUS=${VUS:-}" \
    "$@"
}

_run() {
  local name="$1"
  local file="$2"
  shift 2
  echo ""
  echo "━━ k6 smoke: $name ━━"
  export DURATION="$DUR" VUS="$VUS"
  _k6_run "$@" "$LOAD/$file" || return 1
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "run-housing-k6-edge-smoke (BASE_URL=$BASE_URL, SSL_CERT_FILE=$SSL_CERT_FILE)"

for pair in \
  "gateway-health:k6-gateway-health.js" \
  "auth-health:k6-auth-service-health.js" \
  "listings-health:k6-listings-health.js" \
  "booking-health:k6-booking-health.js" \
  "trust-public:k6-trust-public.js" \
  "analytics-public:k6-analytics-public.js" \
  "messaging:k6-messaging.js" \
  "media-health:k6-media-health.js" \
  "event-layer-adversarial:k6-event-layer-adversarial.js"; do
  name="${pair%%:*}"
  file="${pair#*:}"
  _run "$name" "$file" || {
    echo "⚠️  $name failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
done

if [[ "${SKIP_K6_ANALYTICS_LISTING_FEEL:-0}" != "1" ]]; then
  export DURATION="${K6_ANALYTICS_FEEL_DURATION:-45s}" VUS="${K6_ANALYTICS_FEEL_VUS:-2}"
  _run "analytics-listing-feel" "k6-analytics-listing-feel.js" || {
    echo "⚠️  analytics-listing-feel failed (Ollama cold/down? SKIP_K6_ANALYTICS_LISTING_FEEL=1 to skip)"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
fi

if [[ "${SKIP_K6_BOOKING_SEARCH:-0}" != "1" ]]; then
  say "k6 JWT flows (booking + search/watchlist) via edge $BASE_URL"
  export DURATION="${K6_BOOKING_DURATION:-25s}" VUS="${K6_BOOKING_VUS:-3}"
  _k6_run "$LOAD/k6-booking.js" || {
    echo "⚠️  k6-booking failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
  export DURATION="${K6_SEARCH_DURATION:-25s}" VUS="${K6_SEARCH_VUS:-6}"
  _k6_run "$LOAD/k6-search-watchlist.js" || {
    echo "⚠️  k6-search-watchlist failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
else
  echo "ℹ️  Skip k6-booking/search (SKIP_K6_BOOKING_SEARCH=1)"
fi

say "run-housing-k6-edge-smoke done"
