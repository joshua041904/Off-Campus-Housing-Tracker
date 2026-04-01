#!/usr/bin/env bash
# After a real apply to a cluster: optional kafka-health, gateway rollout + smoke, k6, canary.
# Skips steps when workloads are missing (safe on partial clusters).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
export HOUSING_NS="$NS"

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "=== post-deploy-verify (ns=$NS) ==="

say "Cert hydrate (CI / empty certs/) — POST_DEPLOY_CERTS_ARCHIVE_B64 or cluster Secrets"
chmod +x "$REPO_ROOT/scripts/ci/hydrate-certs-for-ci.sh" 2>/dev/null || true
bash "$REPO_ROOT/scripts/ci/hydrate-certs-for-ci.sh"

if kubectl get statefulset kafka -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  say "Kafka StatefulSet present — rollout wait + kafka-health"
  kubectl rollout status statefulset/kafka -n "$NS" --timeout="${KAFKA_ROLLOUT_TIMEOUT:-600s}" || true
  (cd "$REPO_ROOT" && make kafka-health)
else
  echo "⚠️  No statefulset/kafka — skipping kafka-health"
fi

if kubectl get deployment api-gateway -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  say "API gateway — rollout + smoke + k6"
  kubectl rollout status deployment/api-gateway -n "$NS" --timeout=180s
  bash "$REPO_ROOT/scripts/ci/smoke-api-gateway.sh"
  bash "$REPO_ROOT/scripts/ci/k6-smoke-incluster.sh"
else
  echo "⚠️  No deployment/api-gateway — skipping gateway smoke / k6"
fi

say "Canary stability"
bash "$REPO_ROOT/scripts/ci/canary-pod-stability.sh"

say "✅ post-deploy-verify complete"
exit 0
