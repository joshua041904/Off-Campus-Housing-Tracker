#!/usr/bin/env bash
# Shared gRPC + HTTP/3 health: MetalLB IP :443 only (TLS SNI = HOST). No 127.0.0.1, no port-forward, no NodePort grpcurl.
# Source and call run_grpc_http3_health_checks. Requires: TARGET_IP (MetalLB), CA_CERT or certs/dev-root.pem, strict_http3_curl (from http3.sh).
# Expects: NS, HOST, say/ok/warn/info. Optional: GRPC_CERTS_DIR for mTLS client cert to Envoy.

run_grpc_http3_health_checks() {
  export GRPC_HTTP3_HEALTH_OK=1
  type _kb &>/dev/null || _kb() { kubectl --request-timeout=10s "$@" 2>/dev/null || true; }
  type info &>/dev/null || info() { echo "ℹ️  $*"; }
  local lib_dir="${BASH_SOURCE[0]%/*}"
  local script_dir="${SCRIPT_DIR:-$lib_dir/..}"
  [[ -d "$script_dir" ]] || script_dir="$(cd "$lib_dir/.." && pwd)"
  local ns="${NS:-off-campus-housing-tracker}"
  local host="${HOST:-off-campus-housing.test}"
  local proto_dir=""
  [[ -d "$script_dir/../proto" ]] && proto_dir="$(cd "$script_dir/../proto" && pwd)"
  [[ -z "$proto_dir" ]] && [[ -d "$script_dir/../infra/k8s/base/config/proto" ]] && proto_dir="$(cd "$script_dir/../infra/k8s/base/config/proto" && pwd)"

  if [[ -z "${TARGET_IP:-}" ]]; then
    warn "Health: TARGET_IP (MetalLB) unset — skipping strict HTTP/3 + gRPC (no localhost / port-forward fallbacks)"
    GRPC_HTTP3_HEALTH_OK=0
    export GRPC_HTTP3_HEALTH_OK
    return 0
  fi

  local http3_resolve="${host}:443:${TARGET_IP}"
  local h3_url="https://${host}/_caddy/healthz"

  say "Health: Caddy HTTP/3 (strict TLS, QUIC via MetalLB ${TARGET_IP}:443)"
  info "  Target: $h3_url (curl --resolve $http3_resolve)"
  if ! type strict_http3_curl &>/dev/null; then
    warn "strict_http3_curl not defined (source scripts/lib/http3.sh) — cannot verify HTTP/3 strictly"
    GRPC_HTTP3_HEALTH_OK=0
  else
    local h3_out h3_rc=0
    h3_out=$(strict_http3_curl -sS -w "\n%{http_code}\n%{http_version}" --http3-only --max-time 10 \
      --resolve "$http3_resolve" "$h3_url" 2>&1) || h3_rc=$?
    local h3_code h3_version
    h3_code=$(echo "$h3_out" | tail -2 | head -1)
    h3_version=$(echo "$h3_out" | tail -1)
    info "  HTTP Code: ${h3_code:-none}, Version: ${h3_version:-none}, curl exit: $h3_rc"
    if [[ "$h3_code" == "200" ]]; then
      ok "Caddy HTTP/3 health: OK (HTTP $h3_code, version: $h3_version)"
    else
      warn "Caddy HTTP/3 health: failed (HTTP ${h3_code:-none}, curl exit $h3_rc)"
      echo "$h3_out" | head -5
      GRPC_HTTP3_HEALTH_OK=0
    fi
  fi

  if [[ -z "$proto_dir" ]] || [[ ! -d "$proto_dir" ]] || ! command -v grpcurl >/dev/null 2>&1; then
    warn "gRPC health skipped (proto dir or grpcurl missing)"
    export GRPC_HTTP3_HEALTH_OK
    return 0
  fi

  say "Health: gRPC via Caddy/Envoy (grpcurl → ${TARGET_IP}:443, -authority $host)"
  local grpc_certs_dir="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
  if [[ ! -f "${grpc_certs_dir}/tls.crt" ]] || [[ ! -s "${grpc_certs_dir}/tls.crt" ]]; then
    if [[ -f "$lib_dir/ensure-och-grpc-certs.sh" ]]; then
      # shellcheck source=scripts/lib/ensure-och-grpc-certs.sh
      source "$lib_dir/ensure-och-grpc-certs.sh"
      och_sync_grpc_certs_to_dir "$grpc_certs_dir" "$ns" || true
    fi
  fi
  local use_mtls=0
  [[ -f "${grpc_certs_dir}/tls.crt" ]] && [[ -f "${grpc_certs_dir}/tls.key" ]] && use_mtls=1
  local ca_file="${CA_CERT:-}"
  [[ -z "$ca_file" ]] && [[ -f "$grpc_certs_dir/ca.crt" ]] && ca_file="$grpc_certs_dir/ca.crt"
  if [[ -z "$ca_file" ]] || [[ ! -f "$ca_file" ]] || [[ ! -s "$ca_file" ]]; then
    [[ -f "$script_dir/../certs/dev-root.pem" ]] && ca_file="$(cd "$script_dir/.." && pwd)/certs/dev-root.pem"
  fi
  local grpc_authority="${HOST:-off-campus-housing.test}"
  local out grpc_ok=0
  if [[ -n "$ca_file" ]] && [[ -f "$ca_file" ]]; then
    if [[ $use_mtls -eq 1 ]]; then
      out=$(grpcurl -cacert "$ca_file" -cert "$grpc_certs_dir/tls.crt" -key "$grpc_certs_dir/tls.key" \
        -authority "$grpc_authority" \
        -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 8 -d '{"service":""}' \
        "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || true
    else
      out=$(grpcurl -cacert "$ca_file" -authority "$grpc_authority" \
        -import-path "$proto_dir" -proto "$proto_dir/health.proto" -max-time 8 -d '{"service":""}' \
        "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>&1) || true
    fi
    if echo "$out" | grep -q "SERVING"; then
      [[ $use_mtls -eq 1 ]] && ok "gRPC via MetalLB :443 (mTLS): OK" || ok "gRPC via MetalLB :443 (strict TLS): OK"
      grpc_ok=1
    else
      warn "gRPC via ${TARGET_IP}:443: not OK — check CA, reachability, -authority=$grpc_authority"
      echo "$out" | head -3
      GRPC_HTTP3_HEALTH_OK=0
    fi
  else
    warn "gRPC skipped (no CA — sync certs/dev-root.pem or set CA_CERT)"
    GRPC_HTTP3_HEALTH_OK=0
  fi

  export GRPC_HTTP3_HEALTH_OK
}
