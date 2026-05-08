#!/usr/bin/env bash
# Hard reset: delete housing namespace, docker compose down -v (removes volumes). Extremely destructive.
#
#   DEV_RESET_CONFIRM=yes ./scripts/dev-reset.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

if [[ "${DEV_RESET_CONFIRM:-}" != "yes" ]]; then
  echo "Refusing without DEV_RESET_CONFIRM=yes (compose down -v removes Postgres volumes)." >&2
  exit 2
fi

if command -v kubectl >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/lib/colima-kubeconfig.sh" ]]; then
  # shellcheck source=scripts/lib/colima-kubeconfig.sh
  source "$SCRIPT_DIR/lib/colima-kubeconfig.sh"
  if ! kubectl get nodes --request-timeout=8s >/dev/null 2>&1; then
    och_export_colima_kubeconfig_prefer_reachable || true
  elif [[ -z "${KUBECONFIG:-}" ]]; then
    och_export_colima_kubeconfig_prefer_reachable || {
      _k="${HOME}/.colima/default/kubernetes/kubeconfig"
      [[ -s "$_k" ]] || _k="${HOME}/.colima/default/kubeconfig"
      [[ -s "$_k" ]] && export KUBECONFIG="$_k"
    }
  fi
fi

if command -v kubectl >/dev/null 2>&1; then
  kubectl delete namespace "$NS" --wait=false 2>/dev/null || true
fi

if [[ -f "$REPO_ROOT/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
  (cd "$REPO_ROOT" && docker compose down -v) || true
fi

if [[ "${DEV_RESET_CLEAR_BENCH_LOGS:-0}" == "1" ]]; then
  rm -rf "${REPO_ROOT}/bench_logs"/* 2>/dev/null || true
  echo "ℹ️  cleared bench_logs/* (DEV_RESET_CLEAR_BENCH_LOGS=1)"
fi

echo "✅ dev-reset complete (namespace $NS delete requested; compose down -v)."
