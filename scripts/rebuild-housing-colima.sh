#!/usr/bin/env bash
# Build webapp + selected backend services (:dev), load into Colima Docker, restart Deployments.
# Reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from webapp/.env.local if present (see webapp/env.local.template).
#
# Dev overlay sets webapp imagePullPolicy: Never — kube must use the image loaded below (no registry pull).
#
# Usage (repo root, Colima running):
#   cp webapp/env.local.template webapp/.env.local
#   # edit .env.local - paste key after =
#   ./scripts/rebuild-housing-colima.sh
#   SERVICES=listings-service ./scripts/rebuild-housing-colima.sh
#   SERVICES="auth-service analytics-service" ./scripts/rebuild-housing-colima.sh
#   SKIP_ROLLOUT=1 ./scripts/rebuild-housing-colima.sh   # build+load only
#
# Env:
#   SERVICES                 backend services to build/load/rollout (default: listings-service)
#   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY optional override (skips .env.local if set)
#   SKIP_LOAD=1              build only, no colima docker load
#   SKIP_ROLLOUT=1           load images but no kubectl restart
#   WAIT_ROLLOUT=1           wait rollout status after restart (default 1)
#   ROLLOUT_TIMEOUT=180s     rollout status timeout per deployment
#   HOUSING_NS               default off-campus-housing-tracker
#   DOCKER_DEFAULT_PLATFORM  unset = native (Colima ARM); linux/amd64 for x86-only targets
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
BACKEND_SERVICES="${SERVICES:-listings-service}"
BACKEND_SERVICES="${BACKEND_SERVICES//,/ }"
WAIT_ROLLOUT="${WAIT_ROLLOUT:-1}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180s}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "? $*"; }
warn() { echo "??  $*"; }

extract_maps_key() {
  local f="$REPO_ROOT/webapp/.env.local"
  [[ -f "$f" ]] || return 1
  local line
  line=$(grep -E '^[[:space:]]*NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' "$f" | tail -1) || return 1
  line="${line#*=}"
  line="${line//\"/}"
  line="${line//\'/}"
  line="${line//$'\r'/}"
  line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -n "$line" && "$line" != "PASTE_YOUR_KEY_HERE" ]] || return 1
  printf '%s' "$line"
}

MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}"
if [[ -z "$MAPS_KEY" ]]; then
  if MAPS_KEY="$(extract_maps_key 2>/dev/null)"; then
    ok "Using NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from webapp/.env.local"
  else
    warn "No key in webapp/.env.local (or still PASTE_YOUR_KEY_HERE). Building webapp without Maps embed in bundle."
    warn "Fix: cp webapp/env.local.template webapp/.env.local && edit the key line."
    MAPS_KEY=""
  fi
else
  ok "Using NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from environment"
fi

if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
  say "Docker build webapp (platform=$DOCKER_DEFAULT_PLATFORM, tag=$IMAGE_TAG)..."
  docker build --platform "$DOCKER_DEFAULT_PLATFORM" -f webapp/Dockerfile -t "webapp:${IMAGE_TAG}" \
    --build-arg "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${MAPS_KEY}" \
    "$REPO_ROOT"
else
  say "Docker build webapp (native platform, tag=$IMAGE_TAG)..."
  docker build -f webapp/Dockerfile -t "webapp:${IMAGE_TAG}" \
    --build-arg "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${MAPS_KEY}" \
    "$REPO_ROOT"
fi
ok "Built webapp:${IMAGE_TAG}"

if [[ "${SKIP_LOAD:-0}" == "1" ]]; then
  say "SKIP_LOAD=1 - build backend services only (no VM load/rollout)"
  export SERVICES="$BACKEND_SERVICES"
  export IMAGE_TAG
  export SKIP_LOAD=1
  "$SCRIPT_DIR/build-housing-images-k3s.sh"
  exit 0
fi

if ! command -v colima >/dev/null 2>&1 || ! colima status &>/dev/null; then
  warn "Colima not running - building backend services on host only (no load)."
  export SERVICES="$BACKEND_SERVICES"
  export IMAGE_TAG
  export SKIP_LOAD=1
  "$SCRIPT_DIR/build-housing-images-k3s.sh"
  warn "When Colima is up: docker save webapp:${IMAGE_TAG} | colima ssh -- docker load"
  for s in $BACKEND_SERVICES; do
    warn "  and: docker save ${s}:${IMAGE_TAG} | colima ssh -- docker load"
  done
  exit 0
fi

say "Loading webapp:${IMAGE_TAG} into Colima..."
docker save "webapp:${IMAGE_TAG}" | colima ssh -- docker load
ok "webapp loaded"

say "Building + loading backend services:${IMAGE_TAG} ($BACKEND_SERVICES)..."
export SERVICES="$BACKEND_SERVICES"
export IMAGE_TAG
export SKIP_LOAD=0
"$SCRIPT_DIR/build-housing-images-k3s.sh"

if [[ "${SKIP_ROLLOUT:-0}" == "1" ]]; then
  say "SKIP_ROLLOUT=1 - skipping kubectl"
  exit 0
fi

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found - restart pods manually"
  exit 0
fi

ctx="$(kubectl config current-context 2>/dev/null || echo "")"
if [[ "$ctx" != *colima* ]]; then
  warn "Current kubectl context is '$ctx' (expected colima for this script). Continuing anyway."
fi

say "Replacing webapp pod(s) and rolling backend services in ${HOUSING_NS}..."
kubectl -n "$HOUSING_NS" delete pod -l app=webapp --grace-period=0 --force 2>/dev/null || true
kubectl -n "$HOUSING_NS" rollout restart deployment/webapp --request-timeout=60s
ok "rollout restart deploy/webapp"
for s in $BACKEND_SERVICES; do
  if kubectl -n "$HOUSING_NS" get deploy "$s" -o name &>/dev/null; then
    kubectl -n "$HOUSING_NS" rollout restart "deployment/$s" --request-timeout=60s
    ok "rollout restart deploy/$s"
  else
    warn "No Deployment $s in $HOUSING_NS (skip rollout restart)"
  fi
done

if [[ "$WAIT_ROLLOUT" == "1" ]]; then
  say "Wait: kubectl rollout status deployment/webapp -n ${HOUSING_NS} --timeout=${ROLLOUT_TIMEOUT}"
  kubectl -n "$HOUSING_NS" rollout status deployment/webapp --timeout="$ROLLOUT_TIMEOUT" || true
  for s in $BACKEND_SERVICES; do
    kubectl -n "$HOUSING_NS" get deploy "$s" -o name &>/dev/null || continue
    kubectl -n "$HOUSING_NS" rollout status "deployment/$s" --timeout="$ROLLOUT_TIMEOUT" || true
  done
fi

ok "Done. Maps key is baked into the webapp image at build time; .env.local is not read by running pods."
