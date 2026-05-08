#!/usr/bin/env bash
# Deterministic prelude for `make dev` / dev-orchestrator: explicit guards before heavy work.
# Run from dev-up.sh unless DEV_UP_SKIP_STATE_MACHINE=1.
#
# States (log-only; fail fast on first guard failure):
#   S1  NODE_ENV_VALID   — Node 20.x
#   S2  DOCKER_READY     — docker info
#   S3  K8S_API_READY    — kubectl get nodes (after colima kubeconfig alignment when possible)
#   S4  IMAGES_PRESENT   — when SKIP_BUILD=1, required :dev images must exist locally
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

say "S1 NODE_ENV_VALID"
if ! command -v node >/dev/null 2>&1; then
  bad "node not in PATH"
  exit 1
fi
_nv="$(node -v 2>/dev/null || true)"
if [[ ! "$_nv" =~ ^v20\. ]]; then
  bad "Node 20 required for dev-up (got ${_nv}). Use nvm: nvm use 20"
  exit 1
fi
ok "node ${_nv}"

say "S2 DOCKER_READY"
command -v docker >/dev/null 2>&1 || { bad "docker not in PATH"; exit 1; }
docker info >/dev/null 2>&1 || { bad "docker info failed — start Colima / Docker Desktop"; exit 1; }
ok "docker daemon reachable"

say "S3 K8S_API_READY"
command -v kubectl >/dev/null 2>&1 || { bad "kubectl not in PATH"; exit 1; }
if [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=12s &>/dev/null; then
    och_export_colima_kubeconfig_prefer_reachable || true
  fi
fi
kubectl get nodes --request-timeout=20s >/dev/null 2>&1 || {
  bad "kubectl get nodes failed — fix kubeconfig / start cluster (colima start --with-kubernetes)"
  exit 1
}
ok "Kubernetes API reachable"

say "S4 IMAGES_PRESENT (only when SKIP_BUILD=1)"
if [[ "${SKIP_BUILD:-}" == "1" ]]; then
  _need=()
  if [[ -f "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh" ]]; then
    # shellcheck source=scripts/lib/och-housing-docker-services-default.sh
    source "$SCRIPT_DIR/lib/och-housing-docker-services-default.sh"
    for _n in $HOUSING_DOCKER_SERVICES_DEFAULT webapp; do
      _need+=("${_n}:dev")
    done
  else
    _need=(api-gateway:dev webapp:dev)
  fi
  for _img in "${_need[@]}"; do
    if ! docker image inspect "$_img" &>/dev/null; then
      bad "SKIP_BUILD=1 but missing local image ${_img} — run make images / docker build, or unset SKIP_BUILD"
      exit 1
    fi
  done
  ok "SKIP_BUILD=1 and required :dev images present (${_need[*]})"
else
  ok "SKIP_BUILD unset — orchestrator may build/load images"
fi

ok "dev-up state-machine prelude complete"
