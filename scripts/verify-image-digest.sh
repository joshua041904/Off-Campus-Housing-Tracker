#!/usr/bin/env bash
# Compare local image digest/id with running pod imageID for a deployment.
set -euo pipefail

DEPLOY="${1:-}"
NS="${2:-${HOUSING_NS:-off-campus-housing-tracker}}"
CONTAINER="${3:-$DEPLOY}"

if [[ -z "$DEPLOY" ]]; then
  echo "verify-image-digest: usage: bash scripts/verify-image-digest.sh <deployment> [namespace] [container]"
  exit 2
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "::error::verify-image-digest: kubectl not found"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "::error::verify-image-digest: docker not found"
  exit 1
fi

echo "▶ image-check: deployment=$DEPLOY namespace=$NS container=$CONTAINER"

pod="$(kubectl get pod -n "$NS" -l "app=$DEPLOY" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -z "$pod" ]]; then
  echo "::error::image-check: no pod found via label app=$DEPLOY in ns=$NS"
  echo "  Tip: pass container name/namespace explicitly or adjust labels."
  exit 1
fi

pod_image_id_raw="$(kubectl get pod "$pod" -n "$NS" -o jsonpath="{.status.containerStatuses[?(@.name==\"$CONTAINER\")].imageID}" 2>/dev/null || true)"
if [[ -z "$pod_image_id_raw" ]]; then
  pod_image_id_raw="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].imageID}' 2>/dev/null || true)"
fi
pod_image_id="${pod_image_id_raw#docker-pullable://}"
pod_digest="${pod_image_id##*@}"

deploy_image="$(kubectl get deploy "$DEPLOY" -n "$NS" -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$CONTAINER\")].image}" 2>/dev/null || true)"
if [[ -z "$deploy_image" ]]; then
  deploy_image="$(kubectl get deploy "$DEPLOY" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
fi
if [[ -z "$deploy_image" ]]; then
  echo "::error::image-check: cannot resolve deployment image for $DEPLOY"
  exit 1
fi

local_image="${LOCAL_IMAGE_REF:-$deploy_image}"
if ! docker image inspect "$local_image" >/dev/null 2>&1; then
  echo "::error::image-check: local image not found: $local_image"
  echo "  Build/load image first (e.g., COLD_BOOTSTRAP_REBUILD_APP_IMAGES=1)."
  exit 1
fi

local_repo_digest="$(docker image inspect "$local_image" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
local_repo_digest="${local_repo_digest#*@}"
local_image_id="$(docker image inspect "$local_image" --format '{{.Id}}' 2>/dev/null || true)"
local_image_id="${local_image_id#sha256:}"

echo "  pod=$pod"
echo "  deploy_image=$deploy_image"
echo "  local_image=$local_image"
echo "  pod_image_id=${pod_image_id:-<empty>}"
echo "  local_repo_digest=${local_repo_digest:-<none>}"
echo "  local_image_id=${local_image_id:-<none>}"

if [[ -z "${pod_image_id:-}" ]]; then
  echo "::error::image-check: pod imageID is empty (pod may still be starting)"
  exit 1
fi

if [[ -n "$local_repo_digest" && "$pod_image_id" == *"$local_repo_digest"* ]]; then
  echo "✅ image-check: pod digest matches local repo digest"
  exit 0
fi

if [[ -n "$local_image_id" && "$pod_digest" == "$local_image_id" ]]; then
  echo "✅ image-check: pod digest matches local image id"
  exit 0
fi

echo "::error::image-check: digest mismatch (deployed image appears stale)"
echo "  Suggested: COLD_BOOTSTRAP_REBUILD_APP_IMAGES=1 make cold-bootstrap"
exit 1
