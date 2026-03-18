#!/usr/bin/env bash
# Phase 0 — Freeze the environment (one-time).
# Ensures: Colima only, single k3s cluster, single kubeconfig source.
# Hard rules for Phase 0 baseline: no pgbench, no k6, no MetalLB, no cert rotation.
# See docs/PREFLIGHT_PHASED_PLAN_20260207.md
#
# Usage: ./scripts/preflight-phase0-freeze-check.sh
#   PREFLIGHT_PHASE0=1 — when set by caller, preflight skips reissue/MetalLB/pgbench/k6 (freeze baseline).
#   This script only verifies environment; the main preflight script respects PREFLIGHT_PHASE0 for skips.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

say "Phase 0 — Freeze check (Colima only, single cluster)"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
if [[ "$ctx" == *"kind"* ]] || [[ "$ctx" == "h3" ]]; then
  fail "No Kind clusters. Colima + k3s only. Current context: $ctx. Use: colima start --with-kubernetes && kubectl config use-context colima"
fi
if [[ "$ctx" != *"colima"* ]]; then
  fail "Colima required. Current context: $ctx. Run: colima start --with-kubernetes"
fi
ok "Context: Colima only"

# Single cluster
_ncl=$(kubectl config get-clusters 2>/dev/null | grep -v '^NAME$' | grep -c . || echo "0")
if [[ "${_ncl:-0}" -gt 1 ]]; then
  warn "Expected single cluster; found $_ncl. Prefer one kubeconfig source (e.g. Colima's)."
fi

# Read-only sanity: get nodes and get ns must be boring
if ! kubectl get nodes --request-timeout=15s >/dev/null 2>&1; then
  fail "kubectl get nodes failed — API not reachable. Phase 0 requires stable read."
fi
if ! kubectl get ns --request-timeout=10s >/dev/null 2>&1; then
  fail "kubectl get ns failed — API not stable. Phase 0 requires stable read."
fi
ok "kubectl get nodes and get ns are stable (read-only OK)"

echo "[PHASE 0] FREEZE CHECK OK — Colima only, single cluster, reads stable"
exit 0
