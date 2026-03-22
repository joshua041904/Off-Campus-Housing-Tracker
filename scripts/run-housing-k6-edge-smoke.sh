#!/usr/bin/env bash
# Run k6 health + public + companion scripts against the housing edge (MetalLB + strict TLS or IP + insecure).
# Caller sets: BASE_URL (e.g. https://off-campus-housing.test), K6_RESOLVE (host:443:ip),
# and optionally K6_LB_IP for booking/search scripts that need https://<IP> + Host header.
#
# TLS / trust (see scripts/load/k6-strict-edge-tls.js): standard k6 HTTP ignores per-request `params.tls`;
# edge scripts use `strictEdgeTlsOptions()` (__ENV.K6_RESOLVE, BASE_URL, K6_INSECURE_SKIP_TLS) + global
# `insecureSkipTLSVerify` when needed. CA path is exposed as __ENV.K6_TLS_CA_CERT / K6_CA_ABSOLUTE for gRPC
# and tooling; Go's TLS verifier still uses:
#   • Linux / Docker k6: SSL_CERT_FILE + bundle (export or pass into the container)
#   • macOS host k6: Security.framework → trust dev-root in login keychain (trust-dev-root-ca-macos.sh) or K6_USE_DOCKER_K6=1
#
# _k6_run passes the same -e … vars in native and Docker mode so __ENV is deterministic (no reliance on inherited shell env only).
#
# Usage (from preflight after LB + certs are set):
#   export K6_TLS_CA_CERT=$PWD/certs/dev-root.pem
#   export BASE_URL=https://off-campus-housing.test
#   export K6_RESOLVE=off-campus-housing.test:443:$LB_IP
#   export K6_LB_IP=$LB_IP
#   ./scripts/run-housing-k6-edge-smoke.sh
#
# Env:
#   SKIP_K6_GRID=1           — no-op
#   K6_USE_DOCKER_K6=1       — macOS: run grafana/k6 in Docker (SSL_CERT_FILE works there)
#   K6_DOCKER_IMAGE          — default grafana/k6:latest
#   SKIP_MACOS_DEV_CA_TRUST=1 — macOS: do not run keychain helper (already trusted)
#   K6_SMOKE_DURATION          — default 22s per script (health grid)
#   K6_SMOKE_VUS               — default 5
#   SKIP_K6_BOOKING_SEARCH=1   — skip k6-booking.js + k6-search-watchlist.js (JWT flows)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOAD="$SCRIPT_DIR/load"

[[ "${SKIP_K6_GRID:-0}" == "1" ]] && { echo "SKIP_K6_GRID=1 — skipping"; exit 0; }

_use_docker_k6() {
  [[ "$(uname -s)" == "Darwin" ]] && [[ "${K6_USE_DOCKER_K6:-0}" == "1" ]] && command -v docker >/dev/null 2>&1
}

if ! _use_docker_k6; then
  command -v k6 >/dev/null 2>&1 || { echo "k6 not installed (or set K6_USE_DOCKER_K6=1 with Docker)"; exit 1; }
else
  command -v docker >/dev/null 2>&1 || { echo "K6_USE_DOCKER_K6=1 requires Docker on PATH"; exit 1; }
fi

DUR="${K6_SMOKE_DURATION:-22s}"
VUS="${K6_SMOKE_VUS:-5}"
export K6_INSECURE_SKIP_TLS=0

_ensure_tls_trust() {
  export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"
  export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$K6_TLS_CA_CERT}"
  export SSL_CERT_FILE="${SSL_CERT_FILE:-$K6_TLS_CA_CERT}"
  if [[ "$BASE_URL" == https://* ]] && [[ ! -s "$K6_TLS_CA_CERT" ]]; then
    echo "Strict edge TLS: missing CA at K6_TLS_CA_CERT=$K6_TLS_CA_CERT (run preflight to sync certs/dev-root.pem)"
    exit 1
  fi
  if [[ "$(uname -s)" == "Darwin" ]] && ! _use_docker_k6; then
    if [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" == "1" ]]; then
      echo "SKIP_MACOS_DEV_CA_TRUST=1 — assuming dev-root is already in login keychain."
      return 0
    fi
    "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$K6_TLS_CA_CERT" || {
      echo ""
      echo "k6 on macOS does not use SSL_CERT_FILE for hostname TLS. Fix keychain trust above, or:"
      echo "  K6_USE_DOCKER_K6=1 ./scripts/run-housing-k6-edge-smoke.sh"
      exit 1
    }
  fi
}

_k6_run() {
  if _use_docker_k6; then
    docker run --rm \
      -v "$REPO_ROOT:$REPO_ROOT" \
      -w "$REPO_ROOT" \
      -e "SSL_CERT_FILE=$K6_TLS_CA_CERT" \
      -e "K6_TLS_CA_CERT=$K6_TLS_CA_CERT" \
      -e "K6_CA_ABSOLUTE=$K6_CA_ABSOLUTE" \
      -e "BASE_URL=${BASE_URL:-}" \
      -e "K6_RESOLVE=${K6_RESOLVE:-}" \
      -e "K6_INSECURE_SKIP_TLS=${K6_INSECURE_SKIP_TLS:-0}" \
      -e "DURATION=${DURATION:-}" \
      -e "VUS=${VUS:-}" \
      "${K6_DOCKER_IMAGE:-grafana/k6:latest}" \
      k6 run "$@"
    return $?
  fi
  # Mirror Docker: push edge vars into k6 via -e so __ENV is set even if a parent stripped the environment.
  k6 run \
    -e "BASE_URL=${BASE_URL:-}" \
    -e "K6_RESOLVE=${K6_RESOLVE:-}" \
    -e "K6_TLS_CA_CERT=${K6_TLS_CA_CERT:-}" \
    -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE:-}" \
    -e "K6_INSECURE_SKIP_TLS=${K6_INSECURE_SKIP_TLS:-0}" \
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

say "run-housing-k6-edge-smoke (BASE_URL=${BASE_URL:-unset}, K6_RESOLVE=${K6_RESOLVE:-unset})"

[[ -z "${BASE_URL:-}" ]] && { echo "Set BASE_URL (e.g. https://off-campus-housing.test)"; exit 1; }

_ensure_tls_trust

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
  export K6_INSECURE_SKIP_TLS=1
  export DURATION="${K6_BOOKING_DURATION:-25s}" VUS="${K6_BOOKING_VUS:-3}"
  _k6_run -e BASE_URL="https://$K6_LB_IP" -e HOST="off-campus-housing.test" -e RESOLVE_IP=1 \
    "$LOAD/k6-booking.js" || {
    echo "⚠️  k6-booking failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
  export DURATION="${K6_SEARCH_DURATION:-25s}" VUS="${K6_SEARCH_VUS:-5}"
  _k6_run -e BASE_URL="https://$K6_LB_IP" -e HOST="off-campus-housing.test" -e RESOLVE_IP=1 \
    "$LOAD/k6-search-watchlist.js" || {
    echo "⚠️  k6-search-watchlist failed"
    [[ "${K6_GRID_STRICT:-0}" == "1" ]] && exit 1
    true
  }
else
  echo "ℹ️  Skip k6-booking/search (set K6_LB_IP or unset SKIP_K6_BOOKING_SEARCH)"
fi

say "run-housing-k6-edge-smoke done"
