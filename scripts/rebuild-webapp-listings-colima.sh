#!/usr/bin/env bash
# Build webapp + listings-service (:dev), load into Colima Docker, restart Deployments (fresh pods).
# Reads NEXT_PUBLIC_GOOGLE_MAPS_API_KEY from webapp/.env.local if present (see webapp/env.local.template).
#
# Usage (repo root, Colima running):
#   cp webapp/env.local.template webapp/.env.local
#   # edit .env.local — paste key after =
#   ./scripts/rebuild-webapp-listings-colima.sh
#
# Env:
#   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — optional override (skips .env.local if set)
#   SKIP_LOAD=1          — build only, no colima docker load
#   SKIP_ROLLOUT=1       — load images but no kubectl delete/restart
#   HOUSING_NS           — default off-campus-housing-tracker
#   DOCKER_DEFAULT_PLATFORM — default linux/amd64
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
PLAT="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
IMAGE_TAG="${IMAGE_TAG:-dev}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

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

say "Docker build webapp (platform=$PLAT, tag=$IMAGE_TAG)…"
docker build --platform "$PLAT" -f webapp/Dockerfile -t "webapp:${IMAGE_TAG}" \
  --build-arg "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${MAPS_KEY}" \
  "$REPO_ROOT"
ok "Built webapp:${IMAGE_TAG}"

if [[ "${SKIP_LOAD:-0}" == "1" ]]; then
  say "SKIP_LOAD=1 — skipping Colima load and rollout"
  exit 0
fi

if ! command -v colima >/dev/null 2>&1 || ! colima status &>/dev/null; then
  warn "Colima not running — building listings-service on host only (no load)."
  export SERVICES="listings-service"
  export IMAGE_TAG
  export SKIP_LOAD=1
  "$SCRIPT_DIR/build-housing-images-k3s.sh"
  warn "When Colima is up: docker save webapp:${IMAGE_TAG} | colima ssh -- docker load"
  warn "  and: docker save listings-service:${IMAGE_TAG} | colima ssh -- docker load"
  exit 0
fi

say "Loading webapp:${IMAGE_TAG} into Colima…"
docker save "webapp:${IMAGE_TAG}" | colima ssh -- docker load
ok "webapp loaded"

say "Building + loading listings-service:${IMAGE_TAG}…"
export SERVICES="listings-service"
export IMAGE_TAG
export SKIP_LOAD=0
"$SCRIPT_DIR/build-housing-images-k3s.sh"

if [[ "${SKIP_ROLLOUT:-0}" == "1" ]]; then
  say "SKIP_ROLLOUT=1 — skipping kubectl"
  exit 0
fi

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found — restart pods manually"
  exit 0
fi

ctx="$(kubectl config current-context 2>/dev/null || echo "")"
if [[ "$ctx" != *colima* ]]; then
  warn "Current kubectl context is '$ctx' (expected colima for this script). Continuing anyway."
fi

say "Replacing webapp pods + rolling listings-service in ${HOUSING_NS}…"
kubectl -n "$HOUSING_NS" delete pod -l app=webapp --grace-period=0 --force 2>/dev/null || true
kubectl -n "$HOUSING_NS" rollout restart deployment/webapp --request-timeout=60s
kubectl -n "$HOUSING_NS" rollout restart deployment/listings-service --request-timeout=60s
ok "rollout restart deploy/webapp deploy/listings-service"

say "Wait: kubectl rollout status deployment/webapp -n ${HOUSING_NS} --timeout=180s"
kubectl -n "$HOUSING_NS" rollout status deployment/webapp --timeout=180s || true
kubectl -n "$HOUSING_NS" rollout status deployment/listings-service --timeout=180s || true

ok "Done. Maps key is baked into the webapp image at build time; .env.local is not read by the running pod."
