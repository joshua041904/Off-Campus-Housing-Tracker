#!/usr/bin/env bash
# Build webapp + selected backend services (:dev), load into Colima Docker, restart Deployments.
# Reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from webapp/.env.local if present (see webapp/env.local.template).
#
# Dev overlay sets webapp imagePullPolicy: Never — kube must use the image loaded below (no registry pull).
#
# Usage (repo root, Colima running):
#   Recommended VM shape: colima start --cpus 12 --memory 16 --disk 256 --kubernetes
#   cp webapp/env.local.template webapp/.env.local
#   # edit .env.local - paste key after =
#   ./scripts/rebuild-housing-colima.sh
#   SERVICES=listings-service ./scripts/rebuild-housing-colima.sh
#   SERVICES="auth-service analytics-service" ./scripts/rebuild-housing-colima.sh
#   SERVICES=" booking-service  webapp "   # leading/trailing spaces OK — list is normalized & deduped
#   SKIP_ROLLOUT=1 ./scripts/rebuild-housing-colima.sh   # build+load only
#
# Webapp is always built exactly once in this script. If SERVICES includes "webapp", it is NOT built again
# inside build-housing-images-k3s.sh (avoids duplicate Next.js builds and oversized Colima I/O).
#
# Colima disk / containerd I/O errors: before retrying, consider:
#   docker buildx prune -af && docker system prune -af
#
# Env:
#   HOUSING_IMAGE_RECLAIM_WARN_GB  warn if Images reclaimable exceeds this many GB (default 20)
#   SERVICES                 backend services to build/load/rollout (default: listings-service)
#   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY optional override (skips .env.local if set)
#   SKIP_LOAD=1              build only, no colima docker load
#   SKIP_ROLLOUT=1           load images but no kubectl restart
#   WAIT_ROLLOUT=1           wait rollout status after restart (default 1)
#   ROLLOUT_TIMEOUT=180s     rollout status timeout per deployment
#   HOUSING_NS               default off-campus-housing-tracker
#   DOCKER_DEFAULT_PLATFORM  unset = native (Colima ARM); linux/amd64 for x86-only targets
#   NO_CACHE=1               pass --no-cache to docker build for webapp + selected backend images
#   SKIP_HOST_ALIASES=1      skip scripts/colima-apply-host-aliases.sh after rollout (default: run on colima ctx)
#   HOUSING_ENSURE_BOOKING_SCHEMA=0 — skip ./scripts/ensure-booking-schema.sh after Colima rollout (default: run)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/housing-docker-helpers.sh
source "$SCRIPT_DIR/lib/housing-docker-helpers.sh"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
RAW_SERVICES="${SERVICES:-listings-service}"
BACKEND_SERVICES="$(housing_normalize_service_list "${RAW_SERVICES}")"
# Webapp is always built in the dedicated step below — never send it to build-housing-images-k3s.sh (avoids double build).
BACKEND_FOR_K3S="$(housing_remove_service webapp "${BACKEND_SERVICES}")"
BACKEND_FOR_K3S="$(housing_ensure_api_gateway_rollout "${BACKEND_FOR_K3S}")"
BACKEND_FOR_K3S="$(housing_normalize_service_list "${BACKEND_FOR_K3S}")"
WAIT_ROLLOUT="${WAIT_ROLLOUT:-1}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180s}"
NO_CACHE="${NO_CACHE:-0}"
DOCKER_NO_CACHE_FLAG=()
if [[ "$NO_CACHE" == "1" ]]; then
  DOCKER_NO_CACHE_FLAG=(--no-cache)
fi

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

housing_require_clean_docker_host
housing_use_colima_docker_context
housing_require_docker_daemon
housing_require_colima_running
HOUSING_IMAGE_RECLAIM_WARN_GB="${HOUSING_IMAGE_RECLAIM_WARN_GB:-20}"
housing_warn_large_image_reclaimable "${HOUSING_IMAGE_RECLAIM_WARN_GB}"

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
  say "Docker build webapp (platform=$DOCKER_DEFAULT_PLATFORM, tag=$IMAGE_TAG${NO_CACHE:+ , NO_CACHE=1})..."
  docker build "${DOCKER_NO_CACHE_FLAG[@]}" --platform "$DOCKER_DEFAULT_PLATFORM" -f webapp/Dockerfile -t "webapp:${IMAGE_TAG}" \
    --build-arg "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${MAPS_KEY}" \
    "$REPO_ROOT"
else
  say "Docker build webapp (native platform, tag=$IMAGE_TAG${NO_CACHE:+ , NO_CACHE=1})..."
  docker build "${DOCKER_NO_CACHE_FLAG[@]}" -f webapp/Dockerfile -t "webapp:${IMAGE_TAG}" \
    --build-arg "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${MAPS_KEY}" \
    "$REPO_ROOT"
fi
ok "Built webapp:${IMAGE_TAG}"

if [[ "${SKIP_LOAD:-0}" == "1" ]]; then
  say "SKIP_LOAD=1 - build backend services only (no VM load/rollout)"
  export SERVICES="$BACKEND_FOR_K3S"
  export IMAGE_TAG
  export SKIP_LOAD=1
  export NO_CACHE
  "$SCRIPT_DIR/build-housing-images-k3s.sh"
  exit 0
fi

say "Loading webapp:${IMAGE_TAG} into Colima..."
docker save "webapp:${IMAGE_TAG}" | colima ssh -- docker load
ok "webapp loaded"

say "Resolved service plan:"
echo "  • Webapp: built once above as webapp:${IMAGE_TAG}"
if [[ -n "${BACKEND_FOR_K3S// }" ]]; then
  echo "  • Backend batch (no duplicate webapp): ${BACKEND_FOR_K3S}"
else
  echo "  • Backend batch: (none — skipping k3s service build)"
fi

if [[ -n "${BACKEND_FOR_K3S// }" ]]; then
  say "Building + loading backend services:${IMAGE_TAG} ($BACKEND_FOR_K3S)..."
  export SERVICES="$BACKEND_FOR_K3S"
  export IMAGE_TAG
  export SKIP_LOAD=0
  export NO_CACHE
  "$SCRIPT_DIR/build-housing-images-k3s.sh"
else
  ok "No backend services in SERVICES list (after removing webapp) — skipping build-housing-images-k3s.sh"
fi

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
for s in $BACKEND_FOR_K3S; do
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
  for s in $BACKEND_FOR_K3S; do
    kubectl -n "$HOUSING_NS" get deploy "$s" -o name &>/dev/null || continue
    kubectl -n "$HOUSING_NS" rollout status "deployment/$s" --timeout="$ROLLOUT_TIMEOUT" || true
  done
fi

if [[ "${SKIP_HOST_ALIASES:-0}" != "1" ]] && [[ "$ctx" == *colima* ]] && [[ -x "$REPO_ROOT/scripts/colima-apply-host-aliases.sh" ]]; then
  say "Applying host.docker.internal hostAliases (host Ollama from pods)"
  "$REPO_ROOT/scripts/colima-apply-host-aliases.sh" || warn "colima-apply-host-aliases.sh failed (non-fatal)"
fi

# Host Postgres (e.g. :5443 bookings) is not rolled with images — align SQL so Prisma queries (GET /bookings/mine) never drift.
if [[ "${SKIP_ROLLOUT:-0}" != "1" ]] && [[ "$ctx" == *colima* ]] && [[ "${HOUSING_ENSURE_BOOKING_SCHEMA:-1}" == "1" ]]; then
  if [[ -x "$SCRIPT_DIR/ensure-booking-schema.sh" ]]; then
    say "Host bookings DB: ./scripts/ensure-booking-schema.sh (HOUSING_ENSURE_BOOKING_SCHEMA=0 to skip)"
    PGPASSWORD="${PGPASSWORD:-postgres}" "$SCRIPT_DIR/ensure-booking-schema.sh" ||
      warn "ensure-booking-schema failed — booking-service may return 500 until host DB matches infra/db (see Prisma column errors in logs)."
  fi
fi

ok "Done. Maps key is baked into the webapp image at build time; .env.local is not read by running pods."
