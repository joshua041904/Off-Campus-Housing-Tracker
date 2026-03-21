#!/usr/bin/env bash
# One-shot: start Colima with k3s (--network-address for bridged/LB), create namespaces, install MetalLB (pool 251-260).
# Use after colima delete (or no Colima instance).
#
# Usage:
#   ./scripts/setup-new-colima-cluster.sh
#   # Override MetalLB pool (default 192.168.5.251-192.168.5.260):
#   METALLB_POOL=192.168.64.251-192.168.64.260 ./scripts/setup-new-colima-cluster.sh
#
# Creates namespaces: ingress-nginx, envoy-test, off-campus-housing-tracker.
# Installs MetalLB with pool 251-260 so LoadBalancer IPs are in that range.
# Next: bring up DBs (scripts/bring-up-external-infra.sh), build and load auth-service, deploy.
#
# Env: CPU (default 12), MEMORY (default 16), DISK (default 256), COLIMA_K3S_VERSION,
#      METALLB_POOL (default 192.168.5.251-192.168.5.260), SKIP_METALLB=1 to skip MetalLB install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CPU="${CPU:-12}"
MEMORY="${MEMORY:-16}"
DISK="${DISK:-256}"
# MetalLB pool: leave unset so install-metallb-colima.sh auto-detects VM subnet (eth0). Override if needed: METALLB_POOL=192.168.64.240-192.168.64.250
export METALLB_POOL="${METALLB_POOL:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

TOTAL_STEPS="${TOTAL_STEPS:-6}"
step() {
  local n="$1"
  shift
  say "Step ${n}/${TOTAL_STEPS}: $*"
}

step 1 "Start Colima (${CPU} CPU, ${MEMORY} GiB RAM, ${DISK} GiB disk) with k3s and --network-address (bridged)"
if colima status 2>/dev/null | grep -q "Running"; then
  ok "Colima already running"
else
  colima start --cpu "$CPU" --memory "$MEMORY" --disk "${DISK}" --network-address --with-kubernetes ${COLIMA_K3S_VERSION:+--kubernetes-version "$COLIMA_K3S_VERSION"}
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

step 3 "Create namespaces (ingress-nginx, envoy-test, off-campus-housing-tracker)"
for ns in ingress-nginx envoy-test off-campus-housing-tracker; do
  if kubectl get namespace "$ns" --request-timeout=5s >/dev/null 2>&1; then
    ok "Namespace $ns already exists"
  else
    kubectl create namespace "$ns"
    ok "Created namespace $ns"
  fi
done

if [[ "${SKIP_METALLB:-0}" == "1" ]]; then
  say "Skipping MetalLB (SKIP_METALLB=1). To install later: METALLB_POOL=$METALLB_POOL ./scripts/install-metallb-colima.sh"
else
  step 4 "Install MetalLB (auto pool or METALLB_POOL=$METALLB_POOL)"
  if [[ -x "$SCRIPT_DIR/install-metallb-colima.sh" ]]; then
    "$SCRIPT_DIR/install-metallb-colima.sh"
    ok "MetalLB installed (pool $METALLB_POOL)"
  else
    warn "install-metallb-colima.sh not found; run: METALLB_POOL=$METALLB_POOL ./scripts/install-metallb-colima.sh"
  fi

  step 5 "Verify MetalLB (pods + optional full verify)"
  if kubectl get ns metallb-system --request-timeout=5s &>/dev/null; then
    kubectl -n metallb-system get pods --request-timeout=10s 2>/dev/null || true
    if [[ -x "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" ]] && [[ "${SKIP_METALLB_VERIFY:-0}" != "1" ]]; then
      SKIP_METALLB_ADVANCED=1 VERIFY_MODE=stable "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" 2>/dev/null && ok "MetalLB verification passed" || warn "MetalLB full verify had issues (optional; pool is applied)"
    else
      ok "MetalLB pods listed above. Full verify: SKIP_METALLB_ADVANCED=1 ./scripts/verify-metallb-and-traffic-policy.sh"
    fi
  else
    warn "metallb-system namespace not found; skip verification"
  fi
fi

step 6 "Cluster bootstrap complete"
say "✅ Done (steps 1–${TOTAL_STEPS}/${TOTAL_STEPS}). MetalLB pool: see install-metallb-colima output or: kubectl -n metallb-system get ipaddresspool -o wide"
say "Next (manual pieces): ./scripts/bring-up-external-infra.sh → ./scripts/build-housing-images-k3s.sh → ./scripts/deploy-dev.sh"
say "One-shot (idiot-proof): ./scripts/setup-full-off-campus-housing-stack.sh — see docs/RUN_PIPELINE_ORDER.md"
