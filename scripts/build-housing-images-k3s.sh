#!/usr/bin/env bash
# Build housing service images (:dev) from repo root and load into Colima/k3s (docker save | colima ssh docker load).
# Run after code changes before kubectl rollout restart, when not using a registry.
# Build + rollout helper: ./scripts/rebuild-och-images-and-rollout.sh (or pnpm run rebuild:och:rollout).
#
# Usage: ./scripts/build-housing-images-k3s.sh
#   SERVICES="auth-service api-gateway"  — space- or comma-separated subset (default: all HTTP/gRPC app services)
#   The token "webapp" is stripped: Next.js is built via ./scripts/rebuild-housing-colima.sh (not this script).
#   SKIP_LOAD=1           — build only, do not colima load
#   NO_CACHE=1            — pass --no-cache to docker build for each selected service image
#   HOUSING_IMAGE_RECLAIM_WARN_GB — warn when reclaimable image GB exceeds this (default 20)
#   DOCKER_DEFAULT_PLATFORM — unset = native arch (recommended Apple Silicon + Colima ARM; avoids Prisma segfault under QEMU)
#                             set to linux/amd64 for x86 clusters / CI images only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/housing-docker-helpers.sh
source "$SCRIPT_DIR/lib/housing-docker-helpers.sh"

# shellcheck source=lib/och-housing-docker-services-default.sh
source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"
SERVICES="${SERVICES:-$HOUSING_DOCKER_SERVICES_DEFAULT}"
SERVICES="$(housing_normalize_service_list "${SERVICES}")"
# Never build webapp here when invoked from rebuild-housing-colima.sh (webapp is a separate image tag webapp:dev).
# Standalone invocations may still include webapp — strip it so this script only builds service Dockerfiles under services/.
SERVICES="$(housing_remove_service webapp "${SERVICES}")"
SERVICES="$(housing_normalize_service_list "${SERVICES}")"

# api-gateway runs transport-watchdog as a second container (infra/k8s/base/api-gateway/deploy.yaml).
# If api-gateway is built without loading transport-watchdog:dev into the node image cache, new Pods
# stay ImagePullBackOff (there is no public registry image for that tag).
_WATCHDOG_AUTO_APPENDED=0
if [[ " ${SERVICES} " == *" api-gateway "* ]] && [[ ! " ${SERVICES} " == *" transport-watchdog "* ]]; then
  SERVICES="${SERVICES} transport-watchdog"
  _WATCHDOG_AUTO_APPENDED=1
fi
SERVICES="$(housing_normalize_service_list "${SERVICES}")"

IMAGE_TAG="${IMAGE_TAG:-dev}"
NO_CACHE="${NO_CACHE:-0}"
DOCKER_NO_CACHE_FLAG=()
if [[ "$NO_CACHE" == "1" ]]; then
  DOCKER_NO_CACHE_FLAG=(--no-cache)
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ "${_WATCHDOG_AUTO_APPENDED:-0}" == "1" ]]; then
  warn "Included transport-watchdog (required api-gateway sidecar image)."
fi

if [[ -z "${SERVICES// }" ]]; then
  ok "SERVICES empty after normalization — nothing to build."
  exit 0
fi

housing_require_clean_docker_host
housing_use_colima_docker_context
housing_require_docker_daemon
if [[ "${SKIP_LOAD:-0}" != "1" ]]; then
  housing_require_colima_running
fi
HOUSING_IMAGE_RECLAIM_WARN_GB="${HOUSING_IMAGE_RECLAIM_WARN_GB:-20}"
housing_warn_large_image_reclaimable "${HOUSING_IMAGE_RECLAIM_WARN_GB}"

say "Final docker build service set: ${SERVICES}"

docker_build_service() {
  local tag="$1" dockerfile="$2"
  if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
    docker build "${DOCKER_NO_CACHE_FLAG[@]}" --platform "$DOCKER_DEFAULT_PLATFORM" -t "$tag" -f "$dockerfile" "$REPO_ROOT"
  else
    docker build "${DOCKER_NO_CACHE_FLAG[@]}" -t "$tag" -f "$dockerfile" "$REPO_ROOT"
  fi
}

if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
  say "Building housing images (platform=$DOCKER_DEFAULT_PLATFORM, tag=$IMAGE_TAG)…"
else
  say "Building housing images (native platform, tag=$IMAGE_TAG)…"
fi
for s in $SERVICES; do
  df="services/$s/Dockerfile"
  if [[ "$s" == "webapp" ]]; then
    df="webapp/Dockerfile"
  fi
  if [[ ! -f "$df" ]]; then
    warn "Skip $s (no $df)"
    continue
  fi
  echo "  → $s"
  docker_build_service "${s}:${IMAGE_TAG}" "$df" || {
    warn "Build failed for $s"
    exit 1
  }
  ok "Built ${s}:${IMAGE_TAG}"
done

if [[ "${SKIP_LOAD:-0}" == "1" ]]; then
  say "SKIP_LOAD=1 — not loading into VM"
  exit 0
fi

if command -v colima >/dev/null 2>&1 && colima status &>/dev/null; then
  say "Loading images into Colima (k3s docker)…"
  for s in $SERVICES; do
    if [[ "$s" == "webapp" ]]; then
      [[ -f "webapp/Dockerfile" ]] || continue
    else
      [[ -f "services/$s/Dockerfile" ]] || continue
    fi
    docker save "${s}:${IMAGE_TAG}" | colima ssh -- docker load || warn "Load failed for ${s}:${IMAGE_TAG}"
  done
  ok "Colima docker load complete. Restart pods if needed: kubectl rollout restart deploy/<name> -n off-campus-housing-tracker"
else
  warn "Colima not running — images built on host only. For k3d: docker save … | k3d image import -"
fi
