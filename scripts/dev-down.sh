#!/usr/bin/env bash
# Stop OCH local dev workloads: delete app namespace (Kubernetes) and docker compose down (host Postgres/Redis).
# Does not delete Colima VM or cluster-wide ingress-nginx by default.
#
#   DEV_DOWN_CONFIRM=yes ./scripts/dev-down.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"

if [[ "${DEV_DOWN_CONFIRM:-}" != "yes" ]] && [[ "${DEV_DOWN_CONFIRM:-}" != "y" ]]; then
  echo "Refusing destructive actions without DEV_DOWN_CONFIRM=yes (deletes namespace $NS + compose down)." >&2
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
  (cd "$REPO_ROOT" && docker compose down) || true
fi

echo "✅ dev-down complete (namespace $NS delete requested; compose down)."
