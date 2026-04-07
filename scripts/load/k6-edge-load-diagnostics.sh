#!/usr/bin/env bash
# Capture edge / gateway diagnostics when k6 hits TCP "connection refused" or other failures.
# Repo config excerpts (HAProxy maxconn, nginx worker_connections) — no cluster required.
#
# Usage (source from wrappers):
#   source "$REPO_ROOT/scripts/load/k6-edge-load-diagnostics.sh"
#   k6_diag_repo_snippets "$outdir/snippets.txt"
#   k6_diag_kubectl_snapshots "$outdir" "tag"   # needs kubectl + NS
#
# Env:
#   HOUSING_NS — default off-campus-housing-tracker
#   REPO_ROOT  — repo root for grep of infra manifests
#
# Note: safe to `source` (no set -e — would leak into caller).

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"

k6_diag_repo_snippets() {
  local f="${1:?output file}"
  mkdir -p "$(dirname "$f")"
  {
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) repo manifest excerpts ==="
    if [[ -n "${REPO_ROOT:-}" ]]; then
      echo "--- HAProxy maxconn (infra/k8s/base/haproxy/configmap.yaml) ---"
      grep -n "maxconn" "$REPO_ROOT/infra/k8s/base/haproxy/configmap.yaml" 2>/dev/null || echo "(missing)"
      echo "--- nginx worker_connections (infra/k8s/base/nginx/nginx.conf) ---"
      grep -n "worker_connections" "$REPO_ROOT/infra/k8s/base/nginx/nginx.conf" 2>/dev/null || echo "(missing)"
      echo "--- Caddy servers block (infra/k8s/caddy-h3-configmap.yaml) head ---"
      head -n 40 "$REPO_ROOT/infra/k8s/caddy-h3-configmap.yaml" 2>/dev/null || echo "(missing)"
    else
      echo "REPO_ROOT unset — skipping file grep"
    fi
  } | tee "$f"
}

k6_diag_gateway_ulimit_only() {
  local outdir="${1:?dir}"
  local tag="${2:-ulimit}"
  mkdir -p "$outdir"
  command -v kubectl >/dev/null 2>&1 || {
    echo "kubectl not on PATH" >"$outdir/edge-ulimit-$tag.txt"
    return 0
  }
  {
    echo "=== $tag @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ns=$HOUSING_NS ==="
    echo "--- api-gateway container app: ulimit -n ---"
    kubectl exec -n "$HOUSING_NS" deploy/api-gateway -c app -- sh -c 'ulimit -n' 2>/dev/null || echo "(exec failed)"
    echo "--- somaxconn ---"
    _gw_pod="$(kubectl get pods -n "$HOUSING_NS" -l app=api-gateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [[ -n "$_gw_pod" ]]; then
      kubectl exec -n "$HOUSING_NS" "$_gw_pod" -c app -- sh -c 'cat /proc/sys/net/core/somaxconn 2>/dev/null || true' 2>/dev/null || true
    fi
  } | tee "$outdir/edge-ulimit-$tag.txt"
}

k6_diag_kubectl_snapshots() {
  local outdir="${1:?dir}"
  local tag="${2:-snap}"
  mkdir -p "$outdir"
  command -v kubectl >/dev/null 2>&1 || {
    echo "kubectl not on PATH — skip live snapshots ($tag)" >>"$outdir/kubectl-miss-$tag.txt"
    return 0
  }

  k6_diag_gateway_ulimit_only "$outdir" "$tag"

  kubectl logs -n "$HOUSING_NS" deploy/api-gateway --tail=250 >"$outdir/api-gateway-$tag.log" 2>&1 || true

  kubectl logs -n "$HOUSING_NS" deploy/haproxy --tail=200 >"$outdir/haproxy-${tag}-${HOUSING_NS}.log" 2>&1 || true

  for _cns in ingress-nginx off-campus-housing-tracker; do
    kubectl logs -n "$_cns" deploy/caddy-h3 --tail=200 >"$outdir/caddy-${tag}-${_cns}.log" 2>&1 || true
  done
}
