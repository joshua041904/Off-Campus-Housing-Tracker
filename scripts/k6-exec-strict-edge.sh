#!/usr/bin/env bash
# Run `k6 run …` with correct trust for https://off-campus-housing.test (rotated dev-root CA).
#
# k6's standard HTTP module does NOT honor params.tls.cacerts — it uses Go's default TLS store.
# - Linux / k6 in Docker: SSL_CERT_FILE is honored → we pass K6_TLS_CA_CERT as SSL_CERT_FILE.
# - macOS host k6: Go uses Security.framework → trust dev-root in login keychain, or use Docker k6.
#
# Usage (from repo root):
#   export K6_TLS_CA_CERT="$PWD/certs/dev-root.pem"
#   export BASE_URL=https://off-campus-housing.test
#   ./scripts/k6-exec-strict-edge.sh run scripts/load/k6-gateway-health.js
#
# Env:
#   K6_USE_DOCKER_K6=1   — run grafana/k6 in Docker (Linux; uses SSL_CERT_FILE)
#   K6_DOCKER_IMAGE      — default grafana/k6:latest
#   SKIP_MACOS_DEV_CA_TRUST=1 — skip keychain step (you already trusted the CA)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CA="${K6_TLS_CA_CERT:-$ROOT/certs/dev-root.pem}"
[[ "$CA" != /* ]] && CA="$ROOT/$CA"

_use_docker() {
  [[ "$(uname -s)" == "Darwin" ]] && [[ "${K6_USE_DOCKER_K6:-0}" == "1" ]] && command -v docker >/dev/null 2>&1
}

if ! _use_docker; then
  command -v k6 >/dev/null 2>&1 || {
    echo "k6 not on PATH. Install k6 or set K6_USE_DOCKER_K6=1 with Docker."
    exit 1
  }
else
  command -v docker >/dev/null 2>&1 || {
    echo "K6_USE_DOCKER_K6=1 requires Docker."
    exit 1
  }
fi

if [[ "$(uname -s)" == "Darwin" ]] && ! _use_docker; then
  if [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]]; then
    "$ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$CA" || {
      echo ""
      echo "Options: K6_USE_DOCKER_K6=1 (Docker k6 + SSL_CERT_FILE), or trust the CA manually, or SKIP_MACOS_DEV_CA_TRUST=1."
      exit 1
    }
  fi
else
  export SSL_CERT_FILE="${SSL_CERT_FILE:-$CA}"
fi

if _use_docker; then
  exec docker run --rm \
    -v "$ROOT:$ROOT" \
    -w "$ROOT" \
    -e "SSL_CERT_FILE=$CA" \
    -e "K6_TLS_CA_CERT=$CA" \
    -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE:-$CA}" \
    -e "BASE_URL=${BASE_URL:-}" \
    -e "K6_RESOLVE=${K6_RESOLVE:-}" \
    -e "K6_INSECURE_SKIP_TLS=${K6_INSECURE_SKIP_TLS:-0}" \
    -e "DURATION=${DURATION:-}" \
    -e "VUS=${VUS:-}" \
    "${K6_DOCKER_IMAGE:-grafana/k6:latest}" \
    k6 "$@"
fi

# Native k6: same __ENV as Docker — explicit -e on `run`, not only inherited shell env.
if [[ "${1:-}" == "run" ]]; then
  shift
  exec k6 run \
    -e "BASE_URL=${BASE_URL:-}" \
    -e "K6_RESOLVE=${K6_RESOLVE:-}" \
    -e "K6_TLS_CA_CERT=${K6_TLS_CA_CERT:-$CA}" \
    -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE:-$CA}" \
    -e "K6_INSECURE_SKIP_TLS=${K6_INSECURE_SKIP_TLS:-0}" \
    -e "DURATION=${DURATION:-}" \
    -e "VUS=${VUS:-}" \
    "$@"
fi

exec k6 "$@"
