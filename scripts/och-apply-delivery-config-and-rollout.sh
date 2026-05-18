#!/usr/bin/env bash
# Apply external delivery ConfigMap + optional Secret merge, then restart messaging + webapp.
# Safe for Colima/k3s dev: does NOT replace entire app-secrets (avoids clobbering JWT/Twilio values in git template).
#
# Usage (repo root):
#   ./scripts/och-apply-delivery-config-and-rollout.sh
#   HOUSING_NS=my-ns ./scripts/och-apply-delivery-config-and-rollout.sh
#   MERGE_SMS_GATEWAY_KEYS=1 ./scripts/och-apply-delivery-config-and-rollout.sh
#     When MERGE_SMS_GATEWAY_KEYS=1, adds empty SMS_SELF_HOSTED_* keys if missing (merge patch).
#   SERVICES="messaging-service webapp" APPLY_APP_CONFIG=0 ./scripts/rebuild-och-images-and-rollout.sh
#     — rebuild images after code changes (this script does not build images).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" -n "$NS"
echo "✅ app-config applied to namespace $NS"

if [[ "${MERGE_SMS_GATEWAY_KEYS:-0}" == "1" ]]; then
  kubectl patch secret app-secrets -n "$NS" --type merge -p \
    '{"stringData":{"SMS_SELF_HOSTED_URL":"","SMS_SELF_HOSTED_TOKEN":""}}' || true
  echo "✅ app-secrets merge patch (SMS gateway keys)"
fi

kubectl rollout restart deployment/messaging-service deployment/webapp -n "$NS"
kubectl rollout status deployment/messaging-service -n "$NS" --timeout=180s
kubectl rollout status deployment/webapp -n "$NS" --timeout=300s
echo "✅ messaging-service + webapp rolled out"

kubectl exec -n "$NS" deploy/messaging-service -- printenv EMAIL_DELIVERY_MODE SMS_DELIVERY_MODE 2>/dev/null | paste - - | sed 's/^/   messaging pod: /' || true
