#!/usr/bin/env bash
# Fail-fast route probe for bootstrap trace guarantees.
set -euo pipefail

URL="${1:-}"
TIMEOUT_SEC="${VERIFY_ROUTE_TIMEOUT_SEC:-8}"

if [[ -z "$URL" ]]; then
  echo "verify-route-exists: usage: bash scripts/verify-route-exists.sh <url>"
  exit 2
fi

echo "▶ route-check: probing $URL"
status="$(curl -ksS -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT_SEC" -H "x-suite: ${OCH_X_SUITE:-bash}" "$URL" || true)"

if [[ "$status" == 2* ]]; then
  echo "✅ route-check: $URL -> HTTP $status"
  exit 0
fi

echo "::error::route-check: $URL -> HTTP $status (expected 2xx)"
echo "  Likely causes: stale api-gateway image, route not registered, or wrong E2E_API_BASE."
exit 1
