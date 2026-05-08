#!/usr/bin/env bash
# Fail fast if the k3s API is not usable via kubectl (current kubeconfig).
# Does not curl https://127.0.0.1:6443 — Colima/k3s often has no working host tunnel to :6443 while kubectl works.
#
# Run before heavy kubectl (apply, wait loops, StatefulSet churn):
#   ./scripts/colima-api-health.sh
#
# Env:
#   COLIMA_API_CURL_MAX_TIME — request timeout seconds for kubectl probes (default 5; name kept for compatibility)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

MAXT="${COLIMA_API_CURL_MAX_TIME:-5}"

command -v kubectl >/dev/null 2>&1 || {
  echo "❌ kubectl required"
  exit 1
}

echo "Checking k3s API health (kubectl get --raw /version)…"
if ! kubectl get --raw /version --request-timeout="${MAXT}s" &>/dev/null; then
  echo "❌ kubectl get --raw /version failed (kubeconfig or apiserver unreachable)"
  exit 1
fi

if ! kubectl get nodes --request-timeout="${MAXT}s" >/dev/null; then
  echo "❌ kubectl get nodes failed"
  exit 1
fi

echo "✅ API healthy"
