#!/usr/bin/env bash
# Build housing :dev images from repository root in parallel (same context rules as build-housing-images-k3s.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/och-housing-docker-services-default.sh
source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"

SERVICES="${SERVICES:-$HOUSING_DOCKER_SERVICES_DEFAULT}"
SERVICES="${SERVICES//,/ }"
IMAGE_TAG="${IMAGE_TAG:-dev}"
PARALLELISM="${BUILD_PARALLELISM:-6}"
if [[ "${PARALLELISM:-1}" -lt 1 ]]; then PARALLELISM=1; fi
NO_CACHE="${BUILD_NO_CACHE:-0}"
SKIP_LOAD="${SKIP_LOAD:-0}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

docker_build_one() {
  local s="$1"
  local df="$REPO_ROOT/services/$s/Dockerfile"
  if [[ ! -f "$df" ]]; then
    warn "skip $s (no Dockerfile)"
    return 0
  fi
  local cmd=(docker build)
  if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
    cmd+=(--platform "$DOCKER_DEFAULT_PLATFORM")
  fi
  if [[ "${NO_CACHE:-0}" == "1" ]]; then
    cmd+=(--no-cache)
  fi
  cmd+=(-t "${s}:${IMAGE_TAG}" -f "$df" "$REPO_ROOT")
  echo "  → ${cmd[*]}"
  "${cmd[@]}"
  ok "built ${s}:${IMAGE_TAG}"
}

export -f docker_build_one say ok warn
export REPO_ROOT IMAGE_TAG NO_CACHE DOCKER_DEFAULT_PLATFORM

say "Parallel housing image build (P=$PARALLELISM, tag=$IMAGE_TAG)"
# shellcheck disable=SC2086
printf '%s\n' $SERVICES | xargs -n1 -P"$PARALLELISM" bash -c 'docker_build_one "$@"' _

if [[ "$SKIP_LOAD" == "1" ]]; then
  say "SKIP_LOAD=1 — not loading into Colima"
  exit 0
fi

if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  say "Loading images into Colima (sequential)…"
  for s in $SERVICES; do
    [[ -f "$REPO_ROOT/services/$s/Dockerfile" ]] || continue
    docker save "${s}:${IMAGE_TAG}" | colima ssh -- docker load || warn "Load failed for ${s}:${IMAGE_TAG}"
  done
  ok "Colima docker load complete"
else
  warn "Colima not running — images on host only"
fi
