#!/usr/bin/env bash
# Authoritative check: what image refs Deployments (and running Pods) use — not host docker image store.
#
# Usage (repo root):
#   VERIFY_K8S_SERVICES="auth-service api-gateway ..." ./scripts/ci/verify-k8s-images.sh
#
# Env:
#   HOUSING_NS — default off-campus-housing-tracker
#   VERIFY_K8S_SERVICES — space-separated deployment names (required)
#   VERIFY_K8S_STRICT_DEV — 1: exit 1 if any deployment image does not contain ":dev"
#   VERIFY_K8S_CHECK_DRIFT — 1: warn if pod image != deployment template image
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
SERVICES_RAW="${VERIFY_K8S_SERVICES:-}"
if [[ -z "$SERVICES_RAW" ]]; then
  echo "❌ Set VERIFY_K8S_SERVICES (space-separated deployment names)" >&2
  exit 1
fi

read -r -a SERVICES <<< "$SERVICES_RAW"
any_warn=0

echo "🔎 Kubernetes image refs (namespace=$NS)"
for s in "${SERVICES[@]}"; do
  [[ -z "$s" ]] && continue
  image=""
  image=$(kubectl get deployment "$s" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
  if [[ -z "$image" ]]; then
    echo "❌ Deployment not found: $s"
    exit 1
  fi

  if [[ "$image" != *":dev"* ]]; then
    echo "⚠️  $s → $image (expected *:dev* for local lab)"
    any_warn=1
  else
    echo "✅ $s → $image"
  fi

  if [[ "${VERIFY_K8S_CHECK_DRIFT:-0}" == "1" ]]; then
    pod_img=""
    pod_img=$(kubectl get pods -n "$NS" -l "app=$s" -o jsonpath='{.items[0].spec.containers[0].image}' 2>/dev/null || true)
    if [[ -n "$pod_img" ]] && [[ "$pod_img" != "$image" ]]; then
      echo "⚠️  Drift: $s pod image differs from deployment spec (pod=$pod_img spec=$image)"
      any_warn=1
    fi
  fi
done

if [[ "${VERIFY_K8S_STRICT_DEV:-0}" == "1" ]] && [[ "$any_warn" -eq 1 ]]; then
  echo "❌ VERIFY_K8S_STRICT_DEV=1 and non-:dev or drift warnings present"
  exit 1
fi

echo "✅ Kubernetes deployment image check complete."
