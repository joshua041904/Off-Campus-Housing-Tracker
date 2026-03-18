#!/usr/bin/env bash
# Install MetalLB (native manifests) and apply L2 pool for Colima + k3s.
# Usage: ./scripts/install-metallb-colima.sh
#   METALLB_POOL=192.168.5.240-192.168.5.250   pool on VM L2 (default)
#   METALLB_L2_ONLY=1                          single-node stable: L2 only, skip BGP (stable QUIC; default for new installs)
#   METALLB_L2_ONLY=0                          install BGP too (for multi-node or chaos/stress testing)
# See docs/COLIMA-K3S-METALLB-PRIMARY.md and docs/METALLB_SINGLE_NODE_VS_BGP.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
METALLB_VERSION="${METALLB_VERSION:-v0.14.5}"
# Pool must be on the Colima VM's L2 (same subnet as eth0). VM has eth0=192.168.5.x, col0=192.168.64.x.
# Using 192.168.1.x (home LAN) breaks: host can't reach LB IP, script falls back to socat, HTTP/3 (QUIC) fails.
# Find VM subnet: colima ssh ip addr
METALLB_POOL="${METALLB_POOL:-192.168.5.240-192.168.5.250}"
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
