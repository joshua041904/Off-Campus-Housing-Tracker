#!/usr/bin/env bash
# OCH gRPC harness helpers: topology-aware TLS detection and app deployment listing.
# Source from bash scripts:  source "$SCRIPT_DIR/lib/grpc-utils.sh"
#
# Env: HOUSING_NS (default off-campus-housing-tracker)

och_housing_ns() {
  echo "${HOUSING_NS:-off-campus-housing-tracker}"
}

# Deployments that are OCH app workloads (gRPC/HTTP microservices), excluding infra sidecars.
och_list_app_deployments() {
  local ns="${1:-$(och_housing_ns)}"
  kubectl get deploy -n "$ns" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | grep -E -- '-service$|^api-gateway$' \
    | grep -vE 'nginx|haproxy|exporter' \
    | sort -u
}

# Count of OCH app deployments (dynamic; use instead of hardcoded 7/9).
och_app_deployment_count() {
  och_list_app_deployments "${1:-}" | wc -w | tr -d ' '
}

# True if Deployment manifest indicates strict gRPC TLS (mTLS-capable) in the live cluster object.
# Heuristic: TLS paths or explicit GRPC_REQUIRE_CLIENT_CERT in container env.
och_deploy_grpc_uses_tls() {
  local deploy="${1:?deployment name}"
  local ns="${2:-$(och_housing_ns)}"
  kubectl get deploy -n "$ns" "$deploy" -o yaml 2>/dev/null | grep -qE 'TLS_CERT_PATH|TLS_CA_PATH|GRPC_REQUIRE_CLIENT_CERT|/etc/certs/tls\.crt'
}

# Alias for harness readability (same as och_deploy_grpc_uses_tls).
is_grpc_tls() {
  och_deploy_grpc_uses_tls "$@"
}
