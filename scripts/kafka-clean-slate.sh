#!/usr/bin/env bash
# Nuclear reset: StatefulSet + PVCs + Services (corrupted KRaft / cluster.id mismatch / stuck quorum).
# Destroys broker data — use only when onboarding is broken beyond repair.
#
# Env: HOUSING_NS (default off-campus-housing-tracker)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

echo "=== kafka-clean-slate (ns=$NS) — deletes broker StatefulSet and PVCs ==="
if [[ "${KAFKA_CLEAN_SLATE_CONFIRM:-}" != "YES" ]]; then
  read -r -p "Type YES to delete Kafka data in $NS: " _confirm
  if [[ "$_confirm" != "YES" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

kubectl delete statefulset kafka -n "$NS" --ignore-not-found --request-timeout=60s --wait=true 2>/dev/null || true
for p in data-kafka-0 data-kafka-1 data-kafka-2; do
  kubectl delete pvc "$p" -n "$NS" --ignore-not-found --request-timeout=60s
done
bash "$SCRIPT_DIR/kafka-onboarding-reset.sh"
echo "✅ kafka-clean-slate done. Next: make apply-kafka-kraft (or make dev-onboard)"
