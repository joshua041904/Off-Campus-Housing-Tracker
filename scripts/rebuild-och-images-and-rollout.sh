#!/usr/bin/env bash
# Rebuild selected OCH images (e.g. after Dockerfile probe/TLS/gateway code changes) and rollout Deployments.
# Default includes api-gateway + media-service (common after mTLS/gateway startup fixes).
#
# Usage (repo root):
#   ./scripts/rebuild-och-images-and-rollout.sh
#   SERVICES=api-gateway ./scripts/rebuild-och-images-and-rollout.sh   # gateway only
#   SERVICES="media-service listings-service" SKIP_LOAD=1 ./scripts/rebuild-och-images-and-rollout.sh   # build only
#   ROLLOUT=0 ./scripts/rebuild-och-images-and-rollout.sh   # build/load only, no kubectl restart
#
# Env:
#   SERVICES   — space-separated (default: api-gateway media-service)
#   IMAGE_TAG  — default dev
#   HOUSING_NS — default off-campus-housing-tracker
#   SKIP_LOAD  — passed to build-housing-images-k3s (1 = do not colima docker load)
#   ROLLOUT    — default 1; set 0 to skip kubectl rollout restart
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
SERVICES="${SERVICES:-api-gateway media-service}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
ROLLOUT="${ROLLOUT:-1}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Rebuilding: $SERVICES (tag=$IMAGE_TAG)"
export SERVICES
export IMAGE_TAG
"$SCRIPT_DIR/build-housing-images-k3s.sh"

if [[ "${ROLLOUT:-1}" != "1" ]]; then
  say "ROLLOUT=0 — skipping kubectl rollout restart"
  exit 0
fi

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found — skip rollout"
  exit 0
fi

say "Rollout restart in namespace $HOUSING_NS"
for s in $SERVICES; do
  if kubectl -n "$HOUSING_NS" get deploy "$s" -o name &>/dev/null; then
    kubectl -n "$HOUSING_NS" rollout restart "deploy/$s" --request-timeout=30s
    ok "rollout restart deploy/$s"
  else
    warn "No Deployment $s in $HOUSING_NS (skip)"
  fi
done

say "Wait for rollouts (optional): kubectl rollout status deploy/<name> -n $HOUSING_NS --timeout=120s"
