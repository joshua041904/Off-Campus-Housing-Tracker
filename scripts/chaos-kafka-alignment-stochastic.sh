#!/usr/bin/env bash
# Stochastic Kafka alignment chaos: random pod delete, external Service churn, or TLS refresh — then reconcile.
# Requires CHAOS_CONFIRM=1 and KAFKA_ALIGNMENT_TEST_MODE=1.
#
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, REPO_ROOT (default from script location)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
REP="${KAFKA_BROKER_REPLICAS:-3}"
[[ "$REP" =~ ^[1-9][0-9]*$ ]] || REP=3

if [[ "${CHAOS_CONFIRM:-0}" != "1" ]]; then
  echo "Refusing: set CHAOS_CONFIRM=1"
  exit 2
fi
if [[ "${KAFKA_ALIGNMENT_TEST_MODE:-0}" != "1" ]]; then
  echo "Refusing: set KAFKA_ALIGNMENT_TEST_MODE=1 (destructive)"
  exit 2
fi

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required"; exit 1; }

chmod +x "$SCRIPT_DIR/kafka-runtime-sync.sh" "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" 2>/dev/null || true

pick=$((RANDOM % 3))
echo "=== chaos-kafka-alignment-stochastic pick=$pick (ns=$NS replicas=$REP) ==="

case "$pick" in
  0)
    idx=$((RANDOM % REP))
    echo "▶ Deleting pod kafka-$idx"
    kubectl delete pod "kafka-${idx}" -n "$NS" --request-timeout=45s
    kubectl wait pod "kafka-${idx}" -n "$NS" --for=condition=ready --timeout=300s
    ;;
  1)
    echo "▶ Deleting svc kafka-1-external + re-apply kustomize"
    if [[ ! -d "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" ]]; then
      echo "❌ Missing infra/k8s/kafka-kraft-metallb"
      exit 1
    fi
    kubectl delete svc kafka-1-external -n "$NS" --ignore-not-found --request-timeout=45s || true
    sleep 5
    kubectl apply -k "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" --request-timeout=90s
    sleep 15
    ;;
  2)
    echo "▶ TLS refresh from LB (no pod delete)"
    HOUSING_NS="$NS" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"
    kubectl rollout restart statefulset/kafka -n "$NS" --request-timeout=45s
    kubectl rollout status statefulset/kafka -n "$NS" --timeout="${KAFKA_ROLLOUT_TIMEOUT:-600s}"
    ;;
esac

echo "▶ kafka-runtime-sync --check-only"
set +e
HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"
rc=$?
set -e
if [[ "$rc" -ne 0 ]]; then
  echo "⚠️  Drift after chaos — running --remediate"
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --remediate "$NS" "$REP"
fi

HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"
echo "✅ chaos-kafka-alignment-stochastic complete"
