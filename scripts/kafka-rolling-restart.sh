#!/usr/bin/env bash
# Restart kafka brokers one ordinal at a time (2 → 1 → 0), running verify-kafka-cluster between steps.
# Before each delete: optional app rollout pause, quorum gate (metadata reports a leader).
#
# Env:
#   HOUSING_NS, KAFKA_BROKER_REPLICAS (default 3)
#   KAFKA_ROLLING_PAUSE_APPS=1 — rollout pause all Deployments in ns during restart (reduces client storm)
#   KAFKA_ROLLING_SKIP_VERIFY_STEPS=1 — skip verify-kafka-cluster between pods (faster; less safe)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
R="${KAFKA_BROKER_REPLICAS:-3}"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/kafka-kraft-quorum-ok.sh"

echo "=== kafka-rolling-restart (ns=$NS replicas=$R) ==="

_resume_apps() {
  if [[ "${KAFKA_ROLLING_PAUSE_APPS:-0}" == "1" ]]; then
    echo "▶ rollout resume deployments (all) in $NS"
    kubectl rollout resume deployment -n "$NS" --request-timeout=60s 2>/dev/null || true
  fi
}

trap '_resume_apps' EXIT

if [[ "${KAFKA_ROLLING_PAUSE_APPS:-0}" == "1" ]]; then
  echo "▶ rollout pause deployments (all) in $NS"
  kubectl rollout pause deployment -n "$NS" --request-timeout=60s 2>/dev/null || true
fi

for ((i = R - 1; i >= 0; i--)); do
  echo "▶ Quorum gate before restarting kafka-$i"
  if ! och_kafka_kraft_quorum_ok "$NS"; then
    echo "❌ KRaft quorum not healthy (no LeaderId in describe --status) — aborting rolling restart"
    exit 1
  fi
  echo "▶ Deleting pod kafka-$i (ordered restart)..."
  kubectl delete pod "kafka-$i" -n "$NS" --request-timeout=60s --wait=true
  kubectl wait --for=condition=Ready "pod/kafka-$i" -n "$NS" --timeout=300s
  if [[ "${KAFKA_ROLLING_SKIP_VERIFY_STEPS:-0}" != "1" ]]; then
    echo "▶ verify-kafka-cluster after kafka-$i"
    HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$R" bash "$SCRIPT_DIR/verify-kafka-cluster.sh" "$NS" "$R"
  fi
done

trap - EXIT
_resume_apps
echo "✅ kafka-rolling-restart complete"
