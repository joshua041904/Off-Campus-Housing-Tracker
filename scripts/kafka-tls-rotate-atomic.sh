#!/usr/bin/env bash
# Atomic Kafka TLS refresh: no broker runs while kafka-ssl-secret is replaced (avoids JKS/truststore drift across replicas).
# Uses existing dev-root CA + kafka-refresh-tls-from-lb (MetalLB SANs). Does NOT create a new CA.
#
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS (default 3), KAFKA_TLS_ROTATE_SKIP_GUARD=1 to skip kafka-tls-guard at end
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
R="${KAFKA_BROKER_REPLICAS:-3}"

cd "$REPO_ROOT"

echo "=== kafka-tls-rotate-atomic (ns=$NS replicas=$R) ==="

if ! kubectl get sts kafka -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
  echo "ℹ️  No StatefulSet kafka — run apply-kafka-kraft first. Running kafka-refresh-tls-from-lb only."
  bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"
  exit 0
fi

echo "▶ Scale Kafka to 0 (quorum off — TLS transaction lock)"
kubectl scale statefulset/kafka --replicas=0 -n "$NS" --request-timeout=30s

for ((i = 0; i < R; i++)); do
  kubectl wait --for=delete "pod/kafka-$i" -n "$NS" --timeout=300s 2>/dev/null || true
done

echo "▶ Regenerate kafka-ssl-secret + och-kafka-ssl-secret (full JKS + PEM)"
bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"

echo "▶ Scale Kafka back to $R"
kubectl scale statefulset/kafka --replicas="$R" -n "$NS" --request-timeout=30s

echo "▶ Wait for StatefulSet rollout"
kubectl rollout status statefulset/kafka -n "$NS" --timeout=600s

if [[ "${KAFKA_TLS_ROTATE_SKIP_GUARD:-0}" != "1" ]]; then
  echo "▶ kafka-tls-guard (includes verify-kafka-cluster)"
  bash "$SCRIPT_DIR/kafka-tls-guard.sh"
fi

echo "✅ kafka-tls-rotate-atomic complete"
