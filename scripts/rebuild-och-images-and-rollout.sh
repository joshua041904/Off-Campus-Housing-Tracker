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
#   SERVICES="transport-watchdog api-gateway" …  # watchdog has no Deployment; rollout hits deploy/api-gateway (sidecar)
#   ROLLOUT=0 ./scripts/rebuild-och-images-and-rollout.sh   # build/load only, no kubectl restart
#   WAIT_ROLLOUT=0 ./scripts/rebuild-och-images-and-rollout.sh   # skip rollout status wait
#
# Env:
#   SERVICES   — space-separated (default: api-gateway media-service)
#   IMAGE_TAG  — default dev
#   HOUSING_NS — default off-campus-housing-tracker
#   SKIP_LOAD  — passed to build-housing-images-k3s (1 = do not colima docker load)
#   DOCKER_DEFAULT_PLATFORM — unset = native (Colima ARM); use linux/amd64 for x86-only
#   ROLLOUT    — default 1; set 0 to skip kubectl rollout restart
#   WAIT_ROLLOUT — default 1; set 0 to skip rollout status checks
#   ROLLOUT_TIMEOUT — default 180s per deployment
#   SCALE_DEPLOY_REPLICAS — if set (e.g. 1), kubectl scale deploy/<name> after rollout (dev: wake replicas=0 workloads)
#   APPLY_APP_CONFIG — set 1 to kubectl apply infra/k8s/base/config/app-config.yaml before rollout (refreshes KAFKA_BROKER etc.)
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

if [[ "${APPLY_APP_CONFIG:-0}" == "1" ]] && [[ -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" ]]; then
  say "Applying ConfigMap app-config (KAFKA_BROKER three-broker bootstrap, etc.)"
  kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" -n "$HOUSING_NS"
  ok "app-config applied"
fi

say "Rollout restart in namespace $HOUSING_NS"

# transport-watchdog is a container inside deploy/api-gateway, not its own Deployment.
deploy_for_service() {
  case "$1" in
    transport-watchdog) echo api-gateway ;;
    *) echo "$1" ;;
  esac
}

rollout_targets=""
tw_mapped=0
for s in $SERVICES; do
  d="$(deploy_for_service "$s")"
  if [[ "$s" == "transport-watchdog" ]]; then
    tw_mapped=1
  fi
  rollout_targets="${rollout_targets}"$'\n'"$d"
done
if [[ "$tw_mapped" == "1" ]]; then
  ok "transport-watchdog is a sidecar on deploy/api-gateway (no deploy/transport-watchdog) — rolling api-gateway"
fi
rollout_targets="$(printf '%s\n' "$rollout_targets" | sed '/^$/d' | sort -u)"

for s in $rollout_targets; do
  if kubectl -n "$HOUSING_NS" get deploy "$s" -o name &>/dev/null; then
    kubectl -n "$HOUSING_NS" rollout restart "deploy/$s" --request-timeout=30s
    ok "rollout restart deploy/$s"
    if [[ "$WAIT_ROLLOUT" == "1" ]]; then
      kubectl -n "$HOUSING_NS" rollout status "deploy/$s" --timeout="$ROLLOUT_TIMEOUT" || warn "rollout status timeout for deploy/$s"
    fi
    if [[ -n "${SCALE_DEPLOY_REPLICAS:-}" ]]; then
      kubectl -n "$HOUSING_NS" scale "deploy/$s" --replicas="$SCALE_DEPLOY_REPLICAS"
      ok "scale deploy/$s --replicas=$SCALE_DEPLOY_REPLICAS"
      if [[ "$WAIT_ROLLOUT" == "1" ]]; then
        kubectl -n "$HOUSING_NS" rollout status "deploy/$s" --timeout="$ROLLOUT_TIMEOUT" || warn "rollout status after scale for deploy/$s"
      fi
    fi
  else
    warn "No Deployment $s in $HOUSING_NS (skip)"
  fi
done

if [[ "$WAIT_ROLLOUT" != "1" ]]; then
  say "Wait (manual): kubectl rollout status deploy/<name> -n $HOUSING_NS --timeout=$ROLLOUT_TIMEOUT"
fi
