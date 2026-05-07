#!/usr/bin/env bash
# After manifests apply: restart a Deployment only when the host Docker image digest for :dev
# does not match the running Pod's imageID (same tag, new layers — IfNotPresent will not always refresh).
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/smart-rollout-housing-if-image-changed.sh
# Env:
#   DEPLOY_SKIP_SMART_IMAGE_ROLLOUT=1 — no-op
#   BOOTSTRAP_SKIP_SMART_IMAGE_ROLLOUT=1 — no-op
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
export HOUSING_NS="$NS"

if [[ "${DEPLOY_SKIP_SMART_IMAGE_ROLLOUT:-0}" == "1" ]] || [[ "${BOOTSTRAP_SKIP_SMART_IMAGE_ROLLOUT:-0}" == "1" ]]; then
  echo "ℹ️  smart-rollout skipped (DEPLOY_SKIP_SMART_IMAGE_ROLLOUT / BOOTSTRAP_SKIP_SMART_IMAGE_ROLLOUT)"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }
if ! command -v docker >/dev/null 2>&1; then
  echo "ℹ️  docker not on PATH — skip smart rollout"
  exit 0
fi

DEPLOYS=(
  api-gateway
  auth-service
  listings-service
  booking-service
  messaging-service
  trust-service
  analytics-service
  media-service
  notification-service
)

_och_extract_sha() {
  local s="$1"
  if [[ "$s" =~ sha256:([a-f0-9]{64}) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  echo "$s" | tr -d '[:space:]'
}

_local_digest() {
  local ref="$1"
  local id
  id="$(docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null || true)"
  _och_extract_sha "$id"
}

_pod_digest() {
  _och_extract_sha "$1"
}

_resolve_local_ref_for_container() {
  local deploy="$1"
  local cname="$2"
  local cimage="$3"
  if [[ "$cname" == "transport-watchdog" ]]; then
    echo "transport-watchdog:dev"
    return 0
  fi
  if docker image inspect "$cimage" &>/dev/null; then
    echo "$cimage"
    return 0
  fi
  echo "${deploy}:dev"
}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "smart-rollout-housing-if-image-changed (ns=$NS)"
_any=0
for d in "${DEPLOYS[@]}"; do
  if ! kubectl get "deployment/$d" -n "$NS" --request-timeout=10s &>/dev/null; then
    continue
  fi
  pod="$(kubectl get pods -n "$NS" -l "app=$d" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$pod" ]]; then
    echo "  ℹ️  $d — no running pod yet (skip digest compare)"
    continue
  fi

  restart=0
  while IFS=$'\t' read -r cname cimage cid; do
    [[ -z "$cname" || -z "$cid" ]] && continue
    ref="$(_resolve_local_ref_for_container "$d" "$cname" "$cimage")"
    if ! docker image inspect "$ref" &>/dev/null; then
      echo "  ⚠️  $d pod=$pod container=$cname — no local image $ref (skip compare)"
      continue
    fi
    ldig="$(_local_digest "$ref")"
    pdig="$(_pod_digest "$cid")"
    if [[ -z "$ldig" || -z "$pdig" ]]; then
      echo "  ⚠️  $d/$cname — empty digest (local=$ldig pod=$pdig) → rollout restart"
      restart=1
      continue
    fi
    if [[ "$ldig" != "$pdig" ]]; then
      echo "  ▶ $d/$cname — digest mismatch local=${ldig:0:12}… pod=${pdig:0:12}… → rollout restart"
      restart=1
    fi
  done < <(kubectl get pod "$pod" -n "$NS" -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.image}{"\t"}{.imageID}{"\n"}{end}' 2>/dev/null || true)

  if [[ "$restart" == "1" ]]; then
    kubectl rollout restart "deployment/$d" -n "$NS" --request-timeout=30s
    echo "  ✅ rollout restart triggered: $d"
    _any=1
  else
    echo "  ⏭️  $d — pod image(s) match local :dev (no restart)"
  fi
done

if [[ "$_any" == "1" ]]; then
  echo "✅ smart rollout: one or more Deployments restarted (downstream rollout wait required)"
fi

exit 0
