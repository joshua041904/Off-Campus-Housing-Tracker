#!/usr/bin/env bash
# One-shot: start Colima with k3s (--network-address = bridged VM, same style as historical MetalLB L2 labs).
# MetalLB pool: leave METALLB_POOL unset to auto-derive .240-.250 on the VM eth0 /24 (see install-metallb-colima.sh).
# Use after colima delete (or no Colima instance).
#
# Usage:
#   ./scripts/setup-new-colima-cluster.sh
#   METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/setup-new-colima-cluster.sh   # only if auto-detect wrong
#
# Creates namespaces: ingress-nginx, envoy-test, off-campus-housing-tracker.
# Next: bring up DBs (scripts/bring-up-external-infra.sh), build and load auth-service, deploy.
#
# Env: CPU (default 12), MEMORY (default 16), DISK (default 256),
#      COLIMA_K3S_VERSION (default v1.29.6+k3s1), METALLB_POOL (empty = auto), SKIP_METALLB=1 to skip MetalLB install.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CPU="${CPU:-12}"
MEMORY="${MEMORY:-16}"
DISK="${DISK:-256}"
COLIMA_K3S_VERSION="${COLIMA_K3S_VERSION:-v1.29.6+k3s1}"
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
  colima start --cpu "$CPU" --memory "$MEMORY" --disk "${DISK}" --network-address --with-kubernetes --kubernetes-version "$COLIMA_K3S_VERSION"
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

# Derive MetalLB pool when unset: prefer k3s node InternalIP /24 (authoritative for L2), then Colima eth0.
# eth0 alone can be 192.168.5.x while the node is 192.168.64.x on bridged Colima — same order as install-metallb-colima.sh.
if [[ -z "${METALLB_POOL:-}" ]]; then
  _node_raw="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || true)"
  _node_ip="$(printf '%s\n' "$_node_raw" | awk '{for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) { print $i; exit }}')"
  if [[ -n "$_node_ip" ]]; then
    _nsub="$(echo "$_node_ip" | cut -d. -f1-3)"
    export METALLB_POOL="${_nsub}.240-${_nsub}.250"
    ok "Derived METALLB_POOL=${METALLB_POOL} from k3s node InternalIP (${_node_ip})"
  elif command -v colima >/dev/null 2>&1; then
    _vm_inet="$(colima ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2; exit}' | cut -d/ -f1 || true)"
    if [[ -n "$_vm_inet" ]]; then
      _vm_subnet="$(echo "$_vm_inet" | cut -d. -f1-3)"
      export METALLB_POOL="${_vm_subnet}.240-${_vm_subnet}.250"
      ok "Derived METALLB_POOL=${METALLB_POOL} from Colima eth0 (${_vm_inet}) (no node InternalIP yet)"
    fi
  fi
fi

# Hard fail if user-set or derived pool disagrees with live VM / node subnet (avoids half-migrated Colima network state).
# shellcheck source=scripts/lib/metallb-subnet-guard.sh
# shellcheck disable=SC1091
if [[ -n "${METALLB_POOL:-}" ]] && [[ -f "$SCRIPT_DIR/lib/metallb-subnet-guard.sh" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/metallb-subnet-guard.sh"
  if ! och_assert_metallb_pool_coherent "$METALLB_POOL"; then
    warn "Unset METALLB_POOL to auto-derive from node InternalIP, or set METALLB_POOL to match: kubectl get nodes -o wide"
    exit 1
  fi
fi

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
    _pool_show="${METALLB_POOL:-}"
    if [[ -z "$_pool_show" ]] && kubectl get ipaddresspools -n metallb-system --request-timeout=10s &>/dev/null; then
      _pool_show="$(kubectl get ipaddresspools -n metallb-system -o jsonpath='{.items[0].spec.addresses[0]}' 2>/dev/null || true)"
    fi
    ok "MetalLB installed (pool ${_pool_show:-see metallb-system IPAddressPool})"
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
