#!/usr/bin/env bash
# Build housing service images (:dev) from repo root and load into Colima/k3s (docker save | colima ssh docker load).
# Run after code changes before kubectl rollout restart, when not using a registry.
# Build + rollout helper: ./scripts/rebuild-och-images-and-rollout.sh (or pnpm run rebuild:och:rollout).
#
# Usage: ./scripts/build-housing-images-k3s.sh
#   SERVICES="auth-service api-gateway"  — space- or comma-separated subset (default: all HTTP/gRPC app services)
#   SKIP_LOAD=1           — build only, do not colima load
#   DOCKER_DEFAULT_PLATFORM — unset = native arch (recommended Apple Silicon + Colima ARM; avoids Prisma segfault under QEMU)
#                             set to linux/amd64 for x86 clusters / CI images only
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/och-housing-docker-services-default.sh
source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"
SERVICES="${SERVICES:-$HOUSING_DOCKER_SERVICES_DEFAULT}"
# Allow SERVICES=api-gateway,listings-service (commas → spaces)
SERVICES="${SERVICES//,/ }"

IMAGE_TAG="${IMAGE_TAG:-dev}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

docker_build_service() {
  local tag="$1" dockerfile="$2"
  if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
    docker build --platform "$DOCKER_DEFAULT_PLATFORM" -t "$tag" -f "$dockerfile" "$REPO_ROOT"
  else
    docker build -t "$tag" -f "$dockerfile" "$REPO_ROOT"
  fi
}

if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
  say "Building housing images (platform=$DOCKER_DEFAULT_PLATFORM, tag=$IMAGE_TAG)…"
else
  say "Building housing images (native platform, tag=$IMAGE_TAG)…"
fi
for s in $SERVICES; do
  df="services/$s/Dockerfile"
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
    [[ -f "services/$s/Dockerfile" ]] || continue
    docker save "${s}:${IMAGE_TAG}" | colima ssh -- docker load || warn "Load failed for ${s}:${IMAGE_TAG}"
  done
  ok "Colima docker load complete. Restart pods if needed: kubectl rollout restart deploy/<name> -n off-campus-housing-tracker"
else
  warn "Colima not running — images built on host only. For k3d: docker save … | k3d image import -"
fi
