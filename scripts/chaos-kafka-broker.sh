#!/usr/bin/env bash
# Delete one Kafka broker pod and verify cluster still passes verify-kafka-cluster (quorum / TLS / advert).
# Optional load: set START_K6_LOAD=1 and ensure pnpm k6 script exists (otherwise no background traffic).
#
# Usage: ./scripts/chaos-kafka-broker.sh
# Env:
#   CHAOS_KAFKA_BROKER_INDEX — pod index to delete (default 1 → kafka-1)
#   HOUSING_NS — default off-campus-housing-tracker
#   CHAOS_CONFIRM — must be 1 to run (safety)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
IDX="${CHAOS_KAFKA_BROKER_INDEX:-1}"
POD="kafka-${IDX}"

if [[ "${CHAOS_CONFIRM:-0}" != "1" ]]; then
  echo "Refusing to delete $POD without CHAOS_CONFIRM=1"
  exit 2
fi

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required"; exit 1; }

LOAD_PID=""
if [[ "${START_K6_LOAD:-0}" == "1" ]] && [[ -n "${CHAOS_K6_SCRIPT:-}" ]] && command -v pnpm >/dev/null 2>&1; then
  echo "▶ Background k6: $CHAOS_K6_SCRIPT"
  (cd "$REPO_ROOT" && pnpm exec k6 run "$CHAOS_K6_SCRIPT") &
  LOAD_PID=$!
  sleep 8
elif [[ "${START_K6_LOAD:-0}" == "1" ]]; then
  echo "⚠️  START_K6_LOAD=1 but CHAOS_K6_SCRIPT unset — skipping load (set to a k6 script path under the repo)"
fi

echo "▶ Deleting pod $POD -n $NS …"
kubectl delete pod "$POD" -n "$NS" --request-timeout=30s

echo "▶ Waiting for StatefulSet to recreate broker (~15s)…"
sleep 15

echo "▶ make verify-kafka-cluster"
make -C "$REPO_ROOT" verify-kafka-cluster

if [[ -n "$LOAD_PID" ]]; then
  kill "$LOAD_PID" 2>/dev/null || true
  wait "$LOAD_PID" 2>/dev/null || true
fi

echo "✅ chaos-kafka-broker complete"
