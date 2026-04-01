#!/usr/bin/env bash
# Manually drive the auth outbox publisher N times (in-cluster exec).
# Uses dist/cli/outbox-tick-once.js from the running auth-service image.
#
# Usage:
#   ./scripts/auth-outbox-replay.sh [ticks]   # default 5
# Env: HOUSING_NS (default off-campus-housing-tracker), AUTH_DEPLOY (default auth-service)
set -euo pipefail

TICKS="${1:-5}"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
DEPLOY="${AUTH_DEPLOY:-auth-service}"

if ! [[ "$TICKS" =~ ^[0-9]+$ ]] || [[ "$TICKS" -lt 1 ]]; then
  echo "ticks must be a positive integer" >&2
  exit 1
fi

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

echo "=== auth outbox replay: $TICKS × runAuthOutboxPublisherTick (ns=$NS deploy/$DEPLOY) ==="
for ((i = 1; i <= TICKS; i++)); do
  echo "— tick $i/$TICKS —"
  kubectl exec -n "$NS" "deploy/$DEPLOY" -c app --request-timeout=60s -- \
    node dist/cli/outbox-tick-once.js
done
echo "✅ Done. Inspect: POSTGRES_URL_AUTH=... ./scripts/auth-outbox-inspect.sh"
