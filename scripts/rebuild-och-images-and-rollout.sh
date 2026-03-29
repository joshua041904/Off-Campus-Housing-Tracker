#!/usr/bin/env bash
# Rebuild selected OCH service images and rollout matching Deployments.
# Use this when you changed one or more backend services and want build -> load -> restart to be one command.
#
# Usage (repo root):
#   ./scripts/rebuild-och-images-and-rollout.sh
#   SERVICES=api-gateway ./scripts/rebuild-och-images-and-rollout.sh   # gateway only
#   SERVICES=listings-service ./scripts/rebuild-och-images-and-rollout.sh
#   SERVICES=trust-service ./scripts/rebuild-och-images-and-rollout.sh
#   SERVICES="auth-service analytics-service" ./scripts/rebuild-och-images-and-rollout.sh
#   SERVICES="media-service listings-service" SKIP_LOAD=1 ./scripts/rebuild-och-images-and-rollout.sh   # build only
#   SERVICES="api-gateway,listings-service" ./scripts/rebuild-och-images-and-rollout.sh   # commas OK too
#   ROLLOUT=0 ./scripts/rebuild-och-images-and-rollout.sh   # build/load only, no kubectl restart
#   WAIT_ROLLOUT=0 ./scripts/rebuild-och-images-and-rollout.sh   # skip rollout status wait
#
# Env:
#   SERVICES   — space-separated (default: api-gateway media-service)
#   IMAGE_TAG  — default dev
#   HOUSING_NS — default off-campus-housing-tracker
#   SKIP_LOAD  — passed to build-housing-images-k3s (1 = do not colima docker load)
#   ROLLOUT    — default 1; set 0 to skip kubectl rollout restart
#   WAIT_ROLLOUT — default 1; set 0 to skip rollout status checks
#   ROLLOUT_TIMEOUT — default 180s per deployment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
SERVICES="${SERVICES:-api-gateway media-service}"
# Allow SERVICES=api-gateway,listings-service (commas → spaces)
SERVICES="${SERVICES//,/ }"
IMAGE_TAG="${IMAGE_TAG:-dev}"
ROLLOUT="${ROLLOUT:-1}"
WAIT_ROLLOUT="${WAIT_ROLLOUT:-1}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180s}"

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
    if [[ "$WAIT_ROLLOUT" == "1" ]]; then
      kubectl -n "$HOUSING_NS" rollout status "deploy/$s" --timeout="$ROLLOUT_TIMEOUT" || warn "rollout status timeout for deploy/$s"
    fi
  else
    warn "No Deployment $s in $HOUSING_NS (skip)"
  fi
done

if [[ "$WAIT_ROLLOUT" != "1" ]]; then
  say "Wait (manual): kubectl rollout status deploy/<name> -n $HOUSING_NS --timeout=$ROLLOUT_TIMEOUT"
fi
