#!/usr/bin/env bash
# kubectl that works with Colima when the host kubeconfig still points at 127.0.0.1:6443 but k3s
# uses a dynamic in-VM port (colima.yaml kubernetes.port: 0). Docker CLI and in-VM k3s are independent.
#
# Optional: pin k3s to 6443 on the host — set kubernetes.port: 6443 under `kubernetes:` in ~/.colima/_lima/colima/colima.yaml, then `colima stop && colima start`.
#
# Usage: ./scripts/kubectl-och.sh get pods -n off-campus-housing-tracker
set -euo pipefail

if kubectl cluster-info --request-timeout=5s >/dev/null 2>&1; then
  exec kubectl "$@"
fi

if command -v colima >/dev/null 2>&1 && colima status 2>/dev/null | grep -q "colima is running"; then
  exec colima ssh -- kubectl "$@"
fi

exec kubectl "$@"
