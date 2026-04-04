#!/usr/bin/env bash
# Staged KRaft apply: Services + headless + RBAC → wait LB IPs → refresh kafka-ssl-secret SANs → PDB + StatefulSet.
# KAFKA_TLS_ATOMIC_BEFORE_REFRESH=1 (dev-onboard): scale brokers to 0 before secret refresh so no pod mixes old/new JKS.
#
# Note: StatefulSet stays podManagementPolicy: Parallel — OrderedReady deadlocks KRaft bootstrap (kafka-0 init waits
# for kafka-1/2 DNS before those pods exist). Atomic scale-0 achieves JKS uniformity without OrderedReady.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
R="${KAFKA_BROKER_REPLICAS:-3}"
ATOMIC="${KAFKA_TLS_ATOMIC_BEFORE_REFRESH:-0}"

cd "$REPO_ROOT"

if ! kubectl get secret kafka-ssl-secret -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  echo "ℹ️  kafka-ssl-secret not present yet (OK if TLS_FIRST_TIME_DEFER_KAFKA_JKS=1) — will be created by kafka-refresh-tls-from-lb"
fi

_had_sts=0
_replicas="$R"
if kubectl get sts kafka -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  _had_sts=1
  _replicas="$(kubectl get sts kafka -n "$NS" -o jsonpath='{.spec.replicas}' --request-timeout=15s 2>/dev/null || echo "$R")"
  [[ -z "$_replicas" || "$_replicas" == "null" ]] && _replicas="$R"
fi

echo "▶ apply stage1-services (headless + kafka-*-external + RBAC)"
kubectl apply -f "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/headless-service.yaml" \
  -f "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/external-services.yaml" \
  -f "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml"

if [[ "$ATOMIC" == "1" ]] && [[ "$_had_sts" -eq 1 ]]; then
  echo "▶ KAFKA_TLS_ATOMIC_BEFORE_REFRESH=1 — scale Kafka to 0 before TLS refresh"
  kubectl scale statefulset/kafka --replicas=0 -n "$NS" --request-timeout=30s
  for ((i = 0; i < R; i++)); do
    kubectl wait --for=delete "pod/kafka-$i" -n "$NS" --timeout=300s 2>/dev/null || true
  done
fi

bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"

echo "▶ apply stage2-workloads (PDB + StatefulSet)"
kubectl apply -f "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml" \
  -f "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/statefulset.yaml"

if [[ "$ATOMIC" == "1" ]] && [[ "$_had_sts" -eq 1 ]]; then
  _restore="$_replicas"
  if [[ "${_restore:-0}" -lt 1 ]]; then
    _restore="$R"
    echo "ℹ️  StatefulSet had spec.replicas=0 — restoring to $R after TLS refresh (was not a deliberate scale-down)"
  fi
  echo "▶ Restore replica count ($_restore) after atomic TLS refresh"
  kubectl scale statefulset/kafka --replicas="$_restore" -n "$NS" --request-timeout=30s
elif [[ "$_had_sts" -eq 1 ]]; then
  echo "▶ rollout restart kafka (pick up refreshed kafka-ssl-secret / LB SANs)"
  kubectl rollout restart statefulset/kafka -n "$NS" --request-timeout=30s
fi

echo "▶ wait for kafka rollout"
kubectl rollout status statefulset/kafka -n "$NS" --timeout=480s
echo "✅ apply-kafka-kraft-staged complete"
