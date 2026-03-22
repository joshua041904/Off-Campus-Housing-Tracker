#!/usr/bin/env bash
# Materialize OCH service client TLS material for host tools (grpcurl, etc.) as tls.crt, tls.key, ca.crt.
# Primary: kubectl secret och-service-tls or service-tls in off-campus-housing-tracker (same as pod mounts).
# Fallback: repo certs/off-campus-housing.test.{crt,key} + certs/dev-root.pem → ca.crt.
#
# Usage: source this file, then:
#   och_sync_grpc_certs_to_dir [DEST_DIR] [NAMESPACE]
# DEST defaults to ${GRPC_CERTS_DIR:-/tmp/grpc-certs}; NS defaults to off-campus-housing-tracker.
# Returns 0 if tls.crt and tls.key are non-empty after sync.

och_sync_grpc_certs_to_dir() {
  local dest="${1:-${GRPC_CERTS_DIR:-/tmp/grpc-certs}}"
  local ns="${2:-${OCH_GRPC_CERT_NS:-off-campus-housing-tracker}}"
  local _lib_dir _repo
  _lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
  _repo="$(cd "$_lib_dir/../.." && pwd)"

  mkdir -p "$dest" || return 1

  local secret=""
  if kubectl -n "$ns" get secret och-service-tls -o name &>/dev/null; then
    secret="och-service-tls"
  elif kubectl -n "$ns" get secret service-tls -o name &>/dev/null; then
    secret="service-tls"
  fi

  if [[ -n "$secret" ]]; then
    kubectl -n "$ns" get secret "$secret" -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d >"$dest/tls.crt" 2>/dev/null || true
    kubectl -n "$ns" get secret "$secret" -o jsonpath='{.data.tls\.key}' 2>/dev/null | base64 -d >"$dest/tls.key" 2>/dev/null || true
    kubectl -n "$ns" get secret "$secret" -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -d >"$dest/ca.crt" 2>/dev/null || true
  fi

  if [[ ! -s "$dest/tls.crt" ]] || [[ ! -s "$dest/tls.key" ]]; then
    if [[ -f "$_repo/certs/off-campus-housing.test.crt" ]] && [[ -f "$_repo/certs/off-campus-housing.test.key" ]]; then
      cp -f "$_repo/certs/off-campus-housing.test.crt" "$dest/tls.crt"
      cp -f "$_repo/certs/off-campus-housing.test.key" "$dest/tls.key"
      if [[ -f "$_repo/certs/dev-root.pem" ]]; then
        cp -f "$_repo/certs/dev-root.pem" "$dest/ca.crt"
      fi
    fi
  fi

  [[ -s "$dest/tls.crt" ]] && [[ -s "$dest/tls.key" ]]
}
