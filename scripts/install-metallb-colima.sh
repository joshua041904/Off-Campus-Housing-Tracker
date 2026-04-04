#!/usr/bin/env bash
# Install MetalLB (native manifests) and apply L2 pool for Colima + k3s.
# Usage: ./scripts/install-metallb-colima.sh
#   METALLB_POOL=192.168.64.240-192.168.64.250   pool on VM L2 (default)
#   METALLB_L2_ONLY=1                          single-node stable: L2 only, skip BGP (stable QUIC; default for new installs)
#   METALLB_L2_ONLY=0                          install BGP too (for multi-node or chaos/stress testing)
# See docs/COLIMA-K3S-METALLB-PRIMARY.md and docs/METALLB_SINGLE_NODE_VS_BGP.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
METALLB_VERSION="${METALLB_VERSION:-v0.14.5}"
# Pool must be on the node's L2 subnet (same subnet as InternalIP / Colima eth0).
# Using wrong subnet (e.g. 192.168.1.x home LAN) → EXTERNAL-IP stays <pending>, "bad hostname", HTTP/3 fails.
# Auto-detect node subnet when METALLB_POOL not set so pool always matches current cluster network.
if [[ -z "${METALLB_POOL:-}" ]]; then
  NODE_IP_RAW="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || true)"
  NODE_IP="$(printf '%s\n' "$NODE_IP_RAW" | awk '{for(i=1;i<=NF;i++) if ($i ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) {print $i; exit}}')"
  if [[ -n "$NODE_IP" ]]; then
    NODE_SUBNET="$(echo "$NODE_IP" | awk -F. '{print $1"."$2"."$3}')"
    METALLB_POOL="${NODE_SUBNET}.240-${NODE_SUBNET}.250"
    echo "Auto-detected node InternalIP subnet ${NODE_SUBNET}.x (node ${NODE_IP}); using METALLB_POOL=${METALLB_POOL}"
  fi
fi
# Fallback to Colima eth0 if node lookup is unavailable.
if [[ -z "${METALLB_POOL:-}" ]] && command -v colima &>/dev/null 2>&1; then
  VM_INET="$(colima ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2; exit}' | cut -d/ -f1 || true)"
  if [[ -n "$VM_INET" ]]; then
    VM_SUBNET="$(echo "$VM_INET" | cut -d. -f1-3)"
    METALLB_POOL="${VM_SUBNET}.240-${VM_SUBNET}.250"
    echo "Fallback auto-detected Colima subnet ${VM_SUBNET}.x (eth0 ${VM_INET}); using METALLB_POOL=${METALLB_POOL}"
  fi
fi
METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"
# Single-node stable: L2 only (no BGP). BGP + L2 on one node = dual advertisement = QUIC unstable after speaker churn.
METALLB_L2_ONLY="${METALLB_L2_ONLY:-1}"

# Refresh kubeconfig from Colima (port can change after restart), then fix VM IP → 127.0.0.1.
[[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true
[[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true
if ! kubectl get nodes --request-timeout=5s &>/dev/null; then
  echo "Cannot reach cluster API (stale port or connection refused)."
  echo "  1) Run: ./scripts/colima-fix-kubeconfig-localhost.sh   (refreshes port then fixes host), then retry."
  echo "  2) If still failing: colima status; restart if needed: colima stop; ./scripts/colima-start-k3s-bridged.sh"
  exit 1
fi

echo "Installing MetalLB ${METALLB_VERSION} (native manifests)..."
_manifest_url="https://raw.githubusercontent.com/metallb/metallb/${METALLB_VERSION}/config/manifests/metallb-native.yaml"
_apply_ok=0
for _attempt in 1 2 3; do
  if kubectl apply -f "$_manifest_url" --validate=false 2>&1; then
    _apply_ok=1
    break
  fi
  if [[ $_attempt -lt 3 ]]; then
    echo "  (apply failed — connection refused/EOF or API slow; re-running kubeconfig fix, waiting 15s, retry $((_attempt+1))/3)"
    [[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true
    sleep 15
  fi
done
if [[ $_apply_ok -eq 0 ]]; then
  echo "Manifest apply failed after 3 attempts. Ensure Colima is running, run: ./scripts/colima-fix-kubeconfig-localhost.sh  then retry this script."
  exit 1
fi

echo "Waiting for MetalLB pods to appear..."
for ((p=1;p<=24;p++)); do
  if kubectl -n metallb-system get pods --no-headers 2>/dev/null | grep -q .; then
    break
  fi
  echo "  waiting for MetalLB pods... ($p/24)"
  sleep 5
done
echo "Waiting for MetalLB controller and webhook to be ready..."
if ! kubectl -n metallb-system rollout status deploy/controller --timeout=90s 2>/dev/null; then
  echo "  (controller rollout wait timed out or API slow; continuing to apply pool/L2)"
fi
# Max 30s wait (6 x 5s). Override with PREFLIGHT_METALLB_WEBHOOK_WAIT if needed.
_webhook_polls="${PREFLIGHT_METALLB_WEBHOOK_WAIT:-6}"
[[ "$_webhook_polls" -lt 1 ]] && _webhook_polls=1
webhook_ready=""
for ((i=1;i<=_webhook_polls;i++)); do
  if kubectl -n metallb-system get ep webhook-service -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | grep -q .; then
    webhook_ready=1
    break
  fi
  echo "  waiting for webhook endpoint... ($i/$_webhook_polls)"
  sleep 5
done
_webhook_sec=$(( _webhook_polls * 5 ))
if [[ -z "$webhook_ready" ]]; then
  echo "  (webhook endpoint not ready after ${_webhook_sec}s; see below)"
  echo ""
  echo "  → First check k3s: colima ssh -- sudo systemctl status k3s"
  echo "  → If restart counter is high (200+), k3s is crash-looping — root cause. See docs/COLIMA_K3S_CRASH_LOOP.md"
  echo "  →   Run: ./scripts/colima-diagnose-k3s-crash-loop.sh   then fix k3s (etcd reset or colima delete) before MetalLB."
  echo "  → If k3s is active (running), debug controller: ./scripts/diagnose-metallb-controller.sh   (docs/METALLB_CONTROLLER_DEBUG.md)"
  echo ""
  echo "  Attempting pool/L2 apply anyway (may succeed if webhook became ready)…"
fi

# Ensure API is reachable before apply (connection can drop after long waits). Re-run fix and verify.
echo "Applying IPAddressPool and L2Advertisement (pool: $METALLB_POOL)..."
[[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true
_api_ok=0
for _t in 1 2; do
  if kubectl get nodes --request-timeout=10s &>/dev/null; then
    _api_ok=1
    break
  fi
  [[ $_t -eq 1 ]] && { echo "  API unreachable after wait; refreshing kubeconfig and retrying in 10s..."; [[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true; sleep 10; [[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true; }
done
if [[ $_api_ok -eq 0 ]]; then
  echo "  API unreachable (stale port or connection refused). Run: ./scripts/colima-fix-kubeconfig-localhost.sh  then retry; or restart Colima and retry."
  exit 1
fi

# Reject pool on wrong /24 vs Colima eth0 or k3s node (SKIP_METALLB_SUBNET_GUARD=1 to override).
# shellcheck disable=SC1091
if [[ -f "$SCRIPT_DIR/lib/metallb-subnet-guard.sh" ]]; then
  # shellcheck source=scripts/lib/metallb-subnet-guard.sh
  source "$SCRIPT_DIR/lib/metallb-subnet-guard.sh"
  if ! och_assert_metallb_pool_coherent "$METALLB_POOL"; then
    echo "  Fix: align METALLB_POOL with VM eth0 (see: colima ssh -- ip -4 addr show eth0) or SKIP_METALLB_SUBNET_GUARD=1 for emergency only."
    exit 1
  fi
fi

_apply_pool() {
  sed "s|\$METALLB_POOL|$METALLB_POOL|g" "$REPO_ROOT/infra/k8s/metallb/ipaddresspool.yaml" | kubectl apply -f - --validate=false
  kubectl apply -f "$REPO_ROOT/infra/k8s/metallb/l2advertisement.yaml" --validate=false
}
_apply_pool_ok=0
for _pool_attempt in 1 2 3; do
  if _apply_pool 2>/dev/null; then
    _apply_pool_ok=1
    break
  fi
  if [[ $_pool_attempt -eq 1 ]]; then
    echo "  Pool/L2 apply failed (webhook not ready). Waiting 30s, retrying..."
    sleep 30
  elif [[ $_pool_attempt -eq 2 ]]; then
    echo "  Pool/L2 apply failed again. Waiting 60s, retrying last time..."
    [[ -x "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" ]] && "$SCRIPT_DIR/colima-refresh-kubeconfig.sh" 2>/dev/null || true
    [[ -x "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" ]] && "$SCRIPT_DIR/colima-fix-kubeconfig-localhost.sh" 2>/dev/null || true
    sleep 60
  fi
done
if [[ $_apply_pool_ok -eq 0 ]]; then
  echo "  Pool/L2 apply failed after 3 attempts (webhook endpoint not ready)."
  echo "  → First check k3s: colima ssh -- sudo systemctl status k3s   (if restart counter 200+, k3s is crash-looping — see docs/COLIMA_K3S_CRASH_LOOP.md)"
  echo "  → If k3s is stable, inspect MetalLB controller: ./scripts/diagnose-metallb-controller.sh   (docs/METALLB_CONTROLLER_DEBUG.md)"
  exit 1
fi

# BGP: skip on single-node for stable QUIC (L2-only). Enable for multi-node or stress testing.
if [[ "${METALLB_L2_ONLY:-1}" == "1" ]]; then
  echo "METALLB_L2_ONLY=1: L2 only (single-node stable). BGP not installed. For BGP: METALLB_L2_ONLY=0 ./scripts/install-metallb-colima.sh  or ./scripts/install-metallb-frr-bgp.sh"
else
  if ! kubectl -n metallb-system get bgppeer -o name 2>/dev/null | grep -q .; then
    echo "BGP peer not configured. Installing FRR and BGPPeer..."
    if [[ -x "$SCRIPT_DIR/install-metallb-frr-bgp.sh" ]]; then
      if "$SCRIPT_DIR/install-metallb-frr-bgp.sh"; then
        echo "FRR + BGPPeer installed. LoadBalancer IP and BGP: ./scripts/verify-metallb-and-traffic-policy.sh"
      else
        echo "FRR/BGP install had issues; continuing. You can run ./scripts/install-metallb-frr-bgp.sh manually."
      fi
    else
      echo "To add BGP: ./scripts/install-metallb-frr-bgp.sh   (builds FRR, applies BGPPeer + BGPAdvertisement)"
    fi
  else
    echo "BGP peer(s) already present; skipping FRR install."
  fi
fi

echo "Done. LoadBalancer services will get an IP from $METALLB_POOL. Verify: kubectl -n metallb-system get pods"
echo "  Full verify: ./scripts/verify-metallb-and-traffic-policy.sh   (use SKIP_METALLB_ADVANCED=1 to skip route-flap/BGP stress)"
