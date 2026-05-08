#!/usr/bin/env bash
# Hit gateway-routed /api/*/healthz (and /api/readyz) so each upstream emits HTTP spans → OTLP → Jaeger.
# Use after rollouts or before verify-jaeger-tracing-services.sh when you need every service.name in /api/services.
#
# Usage (repo root):
#   ./scripts/seed-jaeger-via-edge-health.sh
# Env: E2E_API_BASE (default https://off-campus-housing.test), NODE_EXTRA_CA_CERTS (default certs/dev-root.pem)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
[[ -s "$CA" ]] || { echo "seed-jaeger-via-edge-health: missing CA $CA" >&2; exit 1; }

E2E_API_BASE="$(edge_normalize_e2e_api_base)" || exit 1
edge_require_host_resolves "$E2E_API_BASE" || exit 1

BASE="${E2E_API_BASE%/}"
export OCH_X_SUITE="${OCH_X_SUITE:-bash}"
PATHS=(
  /api/healthz
  /api/auth/healthz
  /api/listings/healthz
  /api/booking/healthz
  /api/messaging/healthz
  /api/trust/healthz
  /api/analytics/healthz
  /api/media/healthz
  /api/notification/healthz
  /api/readyz
)

ROUNDS="${SEED_JAEGER_ROUNDS:-3}"
SLEEP_BETWEEN="${SEED_JAEGER_SLEEP_SEC:-2}"

echo "seed-jaeger-via-edge-health: $ROUNDS round(s) → $BASE (paths=${#PATHS[@]})"
for ((r = 1; r <= ROUNDS; r++)); do
  for p in "${PATHS[@]}"; do
    if ! curl -sfS --cacert "$CA" --max-time 20 \
      -H "x-traffic-class: infra" -H "x-suite: ${OCH_X_SUITE}" \
      "${BASE}${p}" >/dev/null; then
      echo "seed-jaeger-via-edge-health: warn round=$r path=$p (non-fatal)" >&2
    fi
  done
  [[ "$r" -lt "$ROUNDS" ]] && sleep "$SLEEP_BETWEEN"
done
echo "seed-jaeger-via-edge-health: done"
