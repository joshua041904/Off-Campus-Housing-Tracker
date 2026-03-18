#!/usr/bin/env bash
# Build auth-service:dev image and load it into the Colima k3s cluster so the auth-service
# deployment can use imagePullPolicy: IfNotPresent.
# Run after setup-new-colima-cluster.sh and with Colima running. Uses Docker (Colima context)
# to build, then imports the image into k3s containerd.
#
# Usage: ./scripts/build-and-load-auth-service.sh
#   DOCKER_CONTEXT=colima  (default when Colima is running) so build runs in VM.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

IMAGE="${AUTH_IMAGE:-auth-service:dev}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# Prefer Colima Docker context so build runs in same VM as k3s
if command -v colima >/dev/null 2>&1 && colima status 2>/dev/null | grep -q "Running"; then
  docker context use colima 2>/dev/null || true
  export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"
  if [[ -S "$HOME/.colima/default/docker.sock" ]] || [[ -f "$HOME/.colima/default/docker.sock" ]]; then
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  fi
fi

if ! docker info >/dev/null 2>&1; then
  warn "Docker not reachable. Start Colima: colima start --with-kubernetes"
  exit 1
fi

say "Building $IMAGE (from repo root)"
docker build -t "$IMAGE" -f services/auth-service/Dockerfile .
ok "Built $IMAGE"

say "Loading $IMAGE into Colima k3s (containerd)"
docker save "$IMAGE" | colima ssh -- sudo k3s ctr -n k8s.io images import -
ok "Loaded $IMAGE into k3s"

say "Done. Deploy with: kubectl apply -k infra/k8s/base/auth-service (ensure namespace off-campus-housing exists)."
