#!/usr/bin/env bash
# Simulate LoadBalancer churn for kafka-0-external: delete Service, wait for re-assign, refresh TLS SANs, verify.
# Destructive to external LB IP for broker 0 — use only on dev clusters.
#
# Usage: CHAOS_CONFIRM=1 ./scripts/chaos-metallb-kafka-lb.sh
# Env: HOUSING_NS (default off-campus-housing-tracker)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"

if [[ "${CHAOS_CONFIRM:-0}" != "1" ]]; then
  echo "Refusing: set CHAOS_CONFIRM=1 (deletes kafka-0-external Service in $NS)"
  exit 2
fi

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required"; exit 1; }

echo "▶ Deleting svc/kafka-0-external -n $NS …"
kubectl delete svc kafka-0-external -n "$NS" --request-timeout=30s

echo "▶ Re-apply kafka external Service (restore from manifest / kustomize if your workflow uses it)"
echo "    If Service is GitOps-managed: kubectl apply -k infra/k8s/kafka-kraft-metallb (or your overlay)"
if [[ -d "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" ]]; then
  kubectl apply -k "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" --request-timeout=60s 2>/dev/null || true
fi

echo "▶ Waiting for new LoadBalancer IP (~20s)…"
sleep 20

echo "▶ kafka-refresh-tls-from-lb + verify-kafka-cluster"
if [[ -x "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" ]]; then
  "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh" || true
fi
make -C "$REPO_ROOT" verify-kafka-cluster

echo "✅ chaos-metallb-kafka-lb complete"
