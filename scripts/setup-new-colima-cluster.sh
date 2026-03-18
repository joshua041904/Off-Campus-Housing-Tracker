#!/usr/bin/env bash
# One-shot: start Colima with k3s and create namespaces only (no MetalLB or other installs).
# Use after colima delete (or no Colima instance).
#
# Usage:
#   ./scripts/setup-new-colima-cluster.sh
#   # To avoid IP conflicts with other projects, set MetalLB pool before later installing MetalLB:
#   METALLB_POOL=192.168.64.260-192.168.64.270 ./scripts/setup-new-colima-cluster.sh
#
# Creates namespaces: ingress-nginx, envoy-test, off-campus-housing.
# Next: install MetalLB (scripts/install-metallb.sh) if needed, then bring up DBs
# (scripts/bring-up-external-infra.sh), build and load auth-service image, deploy.
#
# Env: CPU (default 12), MEMORY (default 16), DISK (default 256), COLIMA_K3S_VERSION.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CPU="${CPU:-12}"
MEMORY="${MEMORY:-16}"
DISK="${DISK:-256}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Step 1: Start Colima (${CPU} CPU, ${MEMORY} GiB RAM, ${DISK} GiB disk) with k3s"
if colima status 2>/dev/null | grep -q "Running"; then
  ok "Colima already running"
else
  colima start --cpu "$CPU" --memory "$MEMORY" --disk "${DISK}" --with-kubernetes ${COLIMA_K3S_VERSION:+--kubernetes-version "$COLIMA_K3S_VERSION"}
  ok "Colima started"
fi

say "Step 2: Wait for Kubernetes API (127.0.0.1:6443)"
for i in $(seq 1 60); do
  if kubectl get ns default --request-timeout=5s >/dev/null 2>&1; then
    ok "API ready"
    break
  fi
  [[ $i -eq 60 ]] && { warn "API not ready after 60 attempts"; exit 1; }
  sleep 5
done

# Ensure kubeconfig uses 127.0.0.1:6443 (Colima tunnel)
if [[ -f "$HOME/.kube/config" ]]; then
  if grep -q "127.0.0.1:6443" "$HOME/.kube/config" 2>/dev/null; then
    : "kubeconfig already points to 127.0.0.1:6443"
  else
    warn "If kubectl fails, run: export KUBECONFIG=\$HOME/.colima/default/kubeconfig or merge Colima kubeconfig"
  fi
fi

say "Step 3: Create namespaces (ingress-nginx, envoy-test, off-campus-housing)"
for ns in ingress-nginx envoy-test off-campus-housing; do
  if kubectl get namespace "$ns" --request-timeout=5s >/dev/null 2>&1; then
    ok "Namespace $ns already exists"
  else
    kubectl create namespace "$ns"
    ok "Created namespace $ns"
  fi
done

say "Done. Next: install MetalLB if needed (METALLB_POOL=192.168.64.260-192.168.64.270 ./scripts/install-metallb.sh), bring up DBs (./scripts/bring-up-external-infra.sh), build and load auth-service (./scripts/build-and-load-auth-service.sh), then deploy."
