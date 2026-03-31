#!/usr/bin/env bash
# Fail fast if the Colima k3s API is not usable through https://127.0.0.1:6443.
# TCP-only checks (nc) are insufficient: the SSH tunnel can accept connections while TLS/API is dead.
#
# Run before heavy kubectl (apply, wait loops, StatefulSet churn):
#   ./scripts/colima-api-health.sh
#
# Env:
#   COLIMA_API_HEALTH_URL — default https://127.0.0.1:6443/version
#   COLIMA_API_CURL_MAX_TIME — default 5 (seconds)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

URL="${COLIMA_API_HEALTH_URL:-https://127.0.0.1:6443/version}"
MAXT="${COLIMA_API_CURL_MAX_TIME:-5}"

command -v curl >/dev/null 2>&1 || {
  echo "❌ curl required for API health probe"
  exit 1
}
command -v kubectl >/dev/null 2>&1 || {
  echo "❌ kubectl required"
  exit 1
}

echo "Checking k3s API health (${URL})..."

code=$(curl -k -s -o /dev/null -w "%{http_code}" --max-time "$MAXT" "$URL" 2>/dev/null || echo "000")
case "$code" in
  2?? | 401 | 403) ;;
  *)
    echo "❌ API not responding (HTTP ${code}; need 2xx/401/403). Fix the 6443 tunnel: ./scripts/colima-forward-6443.sh --restart"
    exit 1
    ;;
esac

if ! kubectl get nodes --request-timeout="${MAXT}s" >/dev/null; then
  echo "❌ kubectl get nodes failed (tunnel or apiserver unhealthy)"
  exit 1
fi

echo "✅ API healthy"
