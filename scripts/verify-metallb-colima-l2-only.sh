#!/usr/bin/env bash
# Run MetalLB verification on Colima k3s (real L2/BGP).
# Use when you want real L2/BGP tests: k3d uses loopback+socat so ARP/asymmetric/BGP are simulated;
# Colima with real L2 yields meaningful ARP, dual-node curl, and BGP results.
#
# Use: kubectl config use-context colima
#      ./scripts/verify-metallb-colima-l2-only.sh
# Or from preflight (k3d): METALLB_VERIFY_COLIMA_L2=1 (preflight will switch to colima, run this, then switch back).
#
# When METALLB_VERIFY_COLIMA_FULL=1: run full verify-metallb-and-traffic-policy.sh (basic + advanced including BGP).
# Otherwise: run advanced only (ARP, asymmetric, hairpin; BGP if BGPPeer exists). Set SKIP_BGP=1 to skip BGP when not using FRR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
# When invoked by preflight (METALLB_VERIFY_COLIMA_FULL=1), preflight already switched to Colima's context (name may be colima, default, or from Colima kubeconfig).
if [[ "${METALLB_VERIFY_COLIMA_FULL:-0}" != "1" ]] && [[ "$ctx" != *"colima"* ]]; then
  warn "Current context is not Colima: $ctx"
  info "Switch to Colima for real L2/BGP verification: kubectl config use-context colima"
  info "Or run preflight with METALLB_VERIFY_COLIMA_L2=1 (preflight switches to Colima for this step only, then back to k3d)."
  info "Then run: ./scripts/verify-metallb-colima-l2-only.sh"
  exit 1
fi

if ! kubectl get nodes --request-timeout=10s >/dev/null 2>&1; then
  warn "Colima API not reachable. Start Colima: colima start --with-kubernetes"
  exit 1
fi

say "=== MetalLB verification on Colima k3s (real L2/BGP) ==="
info "Context: $ctx — running on Colima k3s (real L2; ARP, asymmetric, hairpin, and BGP tests are meaningful)"

if [[ "${METALLB_VERIFY_COLIMA_FULL:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" ]]; then
  # Full verification: basic + advanced (BGP, route flaps, ARP, asymmetric, hairpin, multi-subnet)
  bash "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh"
else
  # Advanced only (ARP, asymmetric, hairpin + BGP when BGPPeer exists). Omit SKIP_BGP so BGP runs if FRR is set up.
  bash "$SCRIPT_DIR/verify-metallb-advanced.sh"
fi
exit $?
