#!/usr/bin/env bash
# Build caddy-with-tcpdump and envoy-with-tcpdump so packet capture works without install timeouts.
# Then ensure the cluster uses these images (k3d: push to registry and patch; Colima/other: patch with local image).
#
# Usage: ./scripts/ensure-caddy-envoy-tcpdump.sh
# Optional: SKIP_BUILD=1 to only patch (images must already exist). SKIP_PATCH=1 to only build.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

# k3d: use registry script (it builds and pushes when BUILD_*=1)
REG_NAME="${K3D_REGISTRY_NAME:-k3d-off-campus-housing-tracker-registry}"
if kubectl config current-context 2>/dev/null | grep -q k3d; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$REG_NAME" || docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$REG_NAME"; then
    say "k3d cluster: building and pushing tcpdump images to registry, then patching"
    BUILD_CADDY_TCPDUMP=1 BUILD_ENVOY_TCPDUMP=1 "$SCRIPT_DIR/k3d-registry-push-and-patch.sh" 2>&1 || true
    ok "k3d: caddy-h3 and envoy-test use *-with-tcpdump from registry"
    exit 0
  fi
fi

# Build both tcpdump images for Colima/other (so capture never waits on in-pod install)
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  say "Building caddy-with-tcpdump and envoy-with-tcpdump"
  if [[ -f docker/caddy-with-tcpdump/Dockerfile ]]; then
    docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile . 2>&1 | tail -5
    ok "Built caddy-with-tcpdump:dev"
  else
    warn "docker/caddy-with-tcpdump/Dockerfile not found"
  fi
  if [[ -f docker/envoy-with-tcpdump/Dockerfile ]]; then
    docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-tcpdump/Dockerfile . 2>&1 | tail -5
    ok "Built envoy-with-tcpdump:dev"
  else
    warn "docker/envoy-with-tcpdump/Dockerfile not found"
  fi
else
  info "SKIP_BUILD=1: using existing caddy-with-tcpdump:dev and envoy-with-tcpdump:dev"
fi

[[ "${SKIP_PATCH:-0}" == "1" ]] && { ok "SKIP_PATCH=1: patch skipped"; exit 0; }

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found; cannot patch deployments"
  exit 0
fi

# Colima or other: patch deployments to use local image (imagePullPolicy: IfNotPresent)
# Images must be available to the cluster (e.g. Colima uses host Docker, so local build is visible)
say "Patching caddy-h3 and envoy-test to use *-with-tcpdump:dev (local image)"
NS_ING="${INGRESS_NS:-ingress-nginx}"
NS_ENVOY="${ENVOY_NS:-envoy-test}"

if kubectl get deployment caddy-h3 -n "$NS_ING" --request-timeout=5s >/dev/null 2>&1; then
  if docker image inspect caddy-with-tcpdump:dev >/dev/null 2>&1; then
    kubectl set image deployment/caddy-h3 -n "$NS_ING" "caddy=caddy-with-tcpdump:dev" --request-timeout=15s 2>/dev/null && \
      ok "Patched caddy-h3 -> caddy-with-tcpdump:dev" || warn "Patch caddy-h3 failed"
    kubectl patch deployment caddy-h3 -n "$NS_ING" --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null || true
  else
    warn "caddy-with-tcpdump:dev not found; run without SKIP_BUILD=1"
  fi
else
  info "Deployment caddy-h3 not found in $NS_ING (skip patch)"
fi

if kubectl get deployment envoy-test -n "$NS_ENVOY" --request-timeout=5s >/dev/null 2>&1; then
  if docker image inspect envoy-with-tcpdump:dev >/dev/null 2>&1; then
    kubectl set image deployment/envoy-test -n "$NS_ENVOY" "envoy=envoy-with-tcpdump:dev" --request-timeout=15s 2>/dev/null && \
      ok "Patched envoy-test -> envoy-with-tcpdump:dev" || warn "Patch envoy-test failed"
    kubectl patch deployment envoy-test -n "$NS_ENVOY" --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null || true
  else
    warn "envoy-with-tcpdump:dev not found; run without SKIP_BUILD=1"
  fi
else
  info "Deployment envoy-test not found in $NS_ENVOY (skip patch)"
fi

ok "Ensure caddy/envoy tcpdump complete. Re-run baseline; packet capture should show TCP/UDP 443 counts."
