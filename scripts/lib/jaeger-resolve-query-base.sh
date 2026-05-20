# shellcheck shell=bash
# Unified Jaeger Query API base for host-run curl/node (verify-jaeger-*, preflight, Playwright).
#
# Prefer in order (first /api/services success wins):
#   1) Existing JAEGER_QUERY_BASE
#   2) JAEGER_PUBLIC_URL (e.g. http://192.168.64.x:16686 MetalLB on svc/jaeger)
#   3) Edge URL https://off-campus-housing.test/jaeger (Caddy → Jaeger; needs QUERY_BASE_PATH=/jaeger on deploy)
#   4) Any svc jaeger / jaeger-query with .status.loadBalancer.ingress[0].ip in common namespaces
#
# Env:
#   JAEGER_DISCOVER_EDGE_JAEGER — default 1; set 0 to skip https://off-campus-housing.test/jaeger probe
#   JAEGER_EDGE_JAEGER_URL — default https://off-campus-housing.test/jaeger
#   NODE_EXTRA_CA_CERTS — for HTTPS edge probe (fallback: $REPO_ROOT/certs/dev-root.pem)
#   TARGET_IP / OCH_EDGE_IP — optional --resolve off-campus-housing.test:443:<ip> when DNS has no LB IP
#
# Exports JAEGER_QUERY_BASE on success. Returns 0 if usable base set, 1 otherwise.

och_jaeger_services_curl_ok() {
  local base="${1%/}"
  [[ -z "$base" ]] && return 1
  if [[ "$base" == https:* ]]; then
    local ca="${NODE_EXTRA_CA_CERTS:-}"
    [[ -z "$ca" || ! -f "$ca" ]] && ca="${REPO_ROOT:-}/certs/dev-root.pem"
    local c=(curl -sfS --max-time 10)
    [[ -f "$ca" ]] && c+=(--cacert "$ca")
    if [[ -n "${TARGET_IP:-}" ]]; then
      c+=(--resolve "off-campus-housing.test:443:${TARGET_IP}")
    elif [[ -n "${OCH_EDGE_IP:-}" ]]; then
      c+=(--resolve "off-campus-housing.test:443:${OCH_EDGE_IP}")
    elif [[ -n "${REACHABLE_LB_IP:-}" ]]; then
      c+=(--resolve "off-campus-housing.test:443:${REACHABLE_LB_IP}")
    fi
    "${c[@]}" "${base}/api/services" >/dev/null 2>&1 && return 0
    return 1
  fi
  curl -sfS --max-time 10 "${base}/api/services" >/dev/null 2>&1
}

och_jaeger_resolve_query_base() {
  local repo_root="${REPO_ROOT:-}"
  if [[ -z "$repo_root" ]]; then
    local _libdir
    _libdir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ "$_libdir" == *"/scripts/lib" ]]; then
      repo_root="$(cd "$_libdir/../.." && pwd)"
    else
      repo_root="$(cd "$_libdir/.." && pwd)"
    fi
  fi
  export REPO_ROOT="$repo_root"

  if [[ -n "${JAEGER_QUERY_BASE:-}" ]] && och_jaeger_services_curl_ok "${JAEGER_QUERY_BASE}"; then
    export JAEGER_QUERY_BASE="${JAEGER_QUERY_BASE%/}"
    return 0
  fi

  [[ -n "${JAEGER_QUERY_BASE:-}" ]] && unset JAEGER_QUERY_BASE

  if [[ -n "${JAEGER_PUBLIC_URL:-}" ]]; then
    local pub="${JAEGER_PUBLIC_URL%/}"
    if och_jaeger_services_curl_ok "$pub"; then
      export JAEGER_QUERY_BASE="$pub"
      echo "Jaeger: JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (from JAEGER_PUBLIC_URL)"
      return 0
    fi
  fi

  if [[ "${JAEGER_DISCOVER_EDGE_JAEGER:-1}" != "0" ]]; then
    local edge="${JAEGER_EDGE_JAEGER_URL:-https://off-campus-housing.test/jaeger}"
    edge="${edge%/}"
    if och_jaeger_services_curl_ok "$edge"; then
      export JAEGER_QUERY_BASE="$edge"
      echo "Jaeger: JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (edge ${edge})"
      return 0
    fi
  fi

  if command -v kubectl >/dev/null 2>&1; then
    local _jq_ip="" _jq_ns="" _jq_name=""
    for _jq_ns in "${JAEGER_OBSERVABILITY_NS:-observability}" observability monitoring tracing jaeger; do
      for _jq_name in jaeger jaeger-query; do
        _jq_ip="$(kubectl -n "$_jq_ns" get svc "$_jq_name" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
        if [[ -n "$_jq_ip" ]]; then
          local lb="http://${_jq_ip}:16686"
          if och_jaeger_services_curl_ok "$lb"; then
            export JAEGER_QUERY_BASE="$lb"
            echo "Jaeger: JAEGER_QUERY_BASE=$JAEGER_QUERY_BASE (${_jq_ns}/svc/${_jq_name} LoadBalancer)"
            return 0
          fi
        fi
      done
    done
  fi

  return 1
}
