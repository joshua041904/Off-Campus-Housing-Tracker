#!/usr/bin/env bash
# Colima factory reset — use when the UI shows a stuck warning, k3s API is wedged, or
# bootstrap auto-heal decides the profile is unhealthy (P0 / C.infra rollback).
#
# Runs (best-effort, non-interactive):
#   1) colima stop
#   2) colima delete -f
#   3) rm -rf ~/.colima
#   4) kubectl prune of stale colima context/cluster/user (if kubectl exists)
#
# Usage: bash scripts/colima-factory-reset.sh
# Makefile: make colima-factory-reset
set -euo pipefail

echo "▶ Colima factory reset: stop → delete -f → rm -rf ~/.colima → kube prune (colima context)…" >&2

if ! command -v colima >/dev/null 2>&1; then
  echo "colima not on PATH — nothing to reset." >&2
  exit 0
fi

colima stop 2>/dev/null || true
colima delete -f 2>/dev/null || true
rm -rf "${HOME}/.colima"

if command -v kubectl >/dev/null 2>&1; then
  kubectl config delete-context colima 2>/dev/null || true
  kubectl config delete-cluster colima 2>/dev/null || true
  kubectl config delete-user colima 2>/dev/null || true
fi

sleep 2
echo "✅ Colima factory reset finished (VM profile removed; next: colima start … or make bootstrap)." >&2
