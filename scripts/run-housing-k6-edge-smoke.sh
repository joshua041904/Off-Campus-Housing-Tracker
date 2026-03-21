#!/usr/bin/env bash
# Run k6 health + public + companion scripts against the housing edge (MetalLB + strict TLS or IP + insecure).
# Caller sets: SSL_CERT_FILE, BASE_URL (e.g. https://off-campus-housing.local), K6_RESOLVE (host:443:ip),
# and optionally K6_LB_IP for booking/search scripts that need https://<IP> + Host header.
#
# Usage (from preflight after LB + certs are set):
#   export SSL_CERT_FILE=$PWD/certs/dev-root.pem
#   export BASE_URL=https://off-campus-housing.local
#   export K6_RESOLVE=off-campus-housing.local:443:$LB_IP
#   export K6_LB_IP=$LB_IP
#   ./scripts/run-housing-k6-edge-smoke.sh
#
# Env:
#   SKIP_K6_GRID=1           — no-op
#   K6_SMOKE_DURATION          — default 22s per script (health grid)
#   K6_SMOKE_VUS               — default 5
#   SKIP_K6_BOOKING_SEARCH=1   — skip k6-booking.js + k6-search-watchlist.js (JWT flows)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOAD="$SCRIPT_DIR/load"

[[ "${SKIP_K6_GRID:-0}" == "1" ]] && { echo "SKIP_K6_GRID=1 — skipping"; exit 0; }
command -v k6 >/dev/null 2>&1 || { echo "k6 not installed"; exit 1; }

DUR="${K6_SMOKE_DURATION:-22s}"
VUS="${K6_SMOKE_VUS:-5}"
export K6_INSECURE_SKIP_TLS=0

_run() {
  local name="$1"
  local file="$2"
  shift 2
  echo ""
  echo "━━ k6 smoke: $name ━━"
  DURATION="$DUR" VUS="$VUS" k6 run "$@" "$LOAD/$file" || return 1
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "run-housing-k6-edge-smoke (BASE_URL=${BASE_URL:-unset}, K6_RESOLVE=${K6_RESOLVE:-unset})"

[[ -z "${BASE_URL:-}" ]] && { echo "Set BASE_URL (e.g. https://off-campus-housing.local)"; exit 1; }

export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"

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

if [[ "${SKIP_K6_BOOKING_SEARCH:-0}" != "1" ]] && [[ -n "${K6_LB_IP:-}" ]]; then
  say "k6 JWT flows (booking + search/watchlist) via https://${K6_LB_IP} + Host header"
  K6_INSECURE_SKIP_TLS=1 DURATION="${K6_BOOKING_DURATION:-25s}" VUS="${K6_BOOKING_VUS:-3}" \
    k6 run -e BASE_URL="https://$K6_LB_IP" -e HOST="off-campus-housing.local" -e RESOLVE_IP=1 \
    "$LOAD/k6-booking.js" || {
    echo "⚠️  k6-booking failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
  K6_INSECURE_SKIP_TLS=1 DURATION="${K6_SEARCH_DURATION:-25s}" VUS="${K6_SEARCH_VUS:-5}" \
    k6 run -e BASE_URL="https://$K6_LB_IP" -e HOST="off-campus-housing.local" -e RESOLVE_IP=1 \
    "$LOAD/k6-search-watchlist.js" || {
    echo "⚠️  k6-search-watchlist failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
else
  echo "ℹ️  Skip k6-booking/search (set K6_LB_IP or unset SKIP_K6_BOOKING_SEARCH)"
fi

say "run-housing-k6-edge-smoke done"
