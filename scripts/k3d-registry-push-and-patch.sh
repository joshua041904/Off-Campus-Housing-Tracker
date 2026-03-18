#!/usr/bin/env bash
# On k3d: ensure registry is reachable, push :dev images to it, patch deployments to use registry:5000/<service>:dev.
# Optional: BUILD_CADDY_TCPDUMP=1 / BUILD_ENVOY_TCPDUMP=1 to build and push tcpdump images.
# Usage: ./scripts/k3d-registry-push-and-patch.sh
# See Runbook #54, docs/PREFLIGHT_ISSUES_AND_FIXES_20260216.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REGISTRY_NAME="${K3D_REGISTRY_NAME:-k3d-off-campus-housing-tracker-registry}"
REG_PORT="${REG_PORT:-5000}"
REGISTRY_ADDR="${REGISTRY_NAME}:${REG_PORT}"
# From host, push to 127.0.0.1:5000 when registry is bound to host
PUSH_ADDR="127.0.0.1:${REG_PORT}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# Ensure registry container exists and is reachable
_ensure_registry() {
  local retries=5
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$REGISTRY_NAME"; then
    docker start "$REGISTRY_NAME" 2>/dev/null || true
    sleep 2
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$REGISTRY_NAME"; then
    : # already running
  else
    warn "Registry container $REGISTRY_NAME not found. Create with k3d-create-2-node-cluster.sh or: docker run -d --name $REGISTRY_NAME -p 127.0.0.1:${REG_PORT}:5000 --restart=always registry:2"
    return 1
  fi
  for i in $(seq 1 $retries); do
    if curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://${PUSH_ADDR}/v2/" 2>/dev/null | grep -qE '200|401|403'; then
      return 0
    fi
    info "Registry not reachable (attempt $i/$retries); waiting 3s..."
    sleep 3
  done
  warn "Registry ${PUSH_ADDR} still not reachable. Add to Docker insecure registries (e.g. Colima: insecure-registries: [\"$REGISTRY_NAME:5000\", \"127.0.0.1:5000\"]), then retry."
  return 1
}

if ! _ensure_registry; then
  exit 1
fi
ok "Registry reachable at ${PUSH_ADDR}"

# Services that use app image (from preflight _reapply_k3d_registry_images)
APPS=(api-gateway auth-service records-service listings-service analytics-service python-ai-service social-service shopping-service auction-monitor)

# Tag and push :dev images (must already be built, e.g. docker build -t api-gateway:dev ...)
for app in "${APPS[@]}"; do
  if docker image inspect "${app}:dev" >/dev/null 2>&1; then
    docker tag "${app}:dev" "${PUSH_ADDR}/${app}:dev" 2>/dev/null || true
    if docker push "${PUSH_ADDR}/${app}:dev" 2>/dev/null; then
      info "Pushed ${app}:dev"
    else
      warn "Push failed for ${app}:dev (is registry insecure? Colima: add insecure-registries in colima.yaml)"
    fi
  else
    warn "Image ${app}:dev not found (build with docker build -t ${app}:dev -f services/${app}/Dockerfile .)"
  fi
done

# Optional: caddy-with-tcpdump, envoy-with-tcpdump
if [[ "${BUILD_CADDY_TCPDUMP:-0}" == "1" ]] && [[ -f "$REPO_ROOT/docker/caddy-with-tcpdump/Dockerfile" ]]; then
  ( cd "$REPO_ROOT" && docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile . 2>&1 ) && \
    docker tag caddy-with-tcpdump:dev "${PUSH_ADDR}/caddy-with-tcpdump:dev" && \
    docker push "${PUSH_ADDR}/caddy-with-tcpdump:dev" 2>/dev/null && info "Pushed caddy-with-tcpdump:dev" || warn "caddy-with-tcpdump push failed"
fi
if [[ "${BUILD_ENVOY_TCPDUMP:-0}" == "1" ]] && [[ -f "$REPO_ROOT/docker/envoy-with-tcpdump/Dockerfile" ]]; then
  ( cd "$REPO_ROOT" && docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-tcpdump/Dockerfile . 2>&1 ) && \
    docker tag envoy-with-tcpdump:dev "${PUSH_ADDR}/envoy-with-tcpdump:dev" && \
    docker push "${PUSH_ADDR}/envoy-with-tcpdump:dev" 2>/dev/null && info "Pushed envoy-with-tcpdump:dev" || warn "envoy-with-tcpdump push failed"
fi

# Patch deployments to use registry (inside k3d, nodes resolve k3d-off-campus-housing-tracker-registry:5000)
if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found; skip patch"
  exit 0
fi
for app in "${APPS[@]}"; do
  if kubectl get deployment "$app" -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then
    kubectl set image "deployment/$app" -n off-campus-housing-tracker "app=${REGISTRY_ADDR}/${app}:dev" --request-timeout=15s 2>/dev/null && info "Patched $app" || warn "Patch $app failed"
  fi
done
# Caddy (ingress-nginx): use caddy-with-tcpdump if we have it in registry, else caddy:2.8.4 (official, has HTTP/3)
if kubectl get deployment caddy-h3 -n ingress-nginx --request-timeout=5s >/dev/null 2>&1; then
  if docker image inspect caddy-with-tcpdump:dev >/dev/null 2>&1; then
    kubectl set image deployment/caddy-h3 -n ingress-nginx "caddy=${REGISTRY_ADDR}/caddy-with-tcpdump:dev" --request-timeout=15s 2>/dev/null && info "Patched caddy-h3 (caddy-with-tcpdump)" || kubectl set image deployment/caddy-h3 -n ingress-nginx "caddy=caddy:2.8.4" --request-timeout=15s 2>/dev/null || true
  else
    kubectl set image deployment/caddy-h3 -n ingress-nginx "caddy=caddy:2.8.4" --request-timeout=15s 2>/dev/null || true
  fi
fi
if kubectl get deployment envoy-test -n envoy-test --request-timeout=5s >/dev/null 2>&1; then
  kubectl set image deployment/envoy-test -n envoy-test "envoy=${REGISTRY_ADDR}/envoy-with-tcpdump:dev" --request-timeout=15s 2>/dev/null || true
fi

ok "Registry push and patch complete. Deployments use ${REGISTRY_ADDR}/<image>:dev"
