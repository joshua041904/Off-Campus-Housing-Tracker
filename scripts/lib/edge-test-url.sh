#!/usr/bin/env bash
# Shared helpers: edge-only E2E / k6 (https://off-campus-housing.test), no port-forward / :4020.
# shellcheck shell=bash

EDGE_TEST_DEFAULT_BASE="https://off-campus-housing.test"

# Print normalized E2E API base to stdout; warnings on stderr. Rejects legacy port-forward URLs.
edge_normalize_e2e_api_base() {
  local raw="${E2E_API_BASE:-}"
  raw="${raw%/}"
  if [[ -z "$raw" ]]; then
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" =~ ^http://127\.0\.0\.1:4020 ]] || [[ "$raw" =~ ^http://localhost:4020 ]]; then
    echo "⚠️  Ignoring legacy E2E_API_BASE=$raw (port-forward / :4020 removed). Using $EDGE_TEST_DEFAULT_BASE" >&2
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" != https://* ]]; then
    echo "❌ E2E_API_BASE must be https://… (got: $raw). Unset it or set to $EDGE_TEST_DEFAULT_BASE" >&2
    return 1
  fi
  printf '%s\n' "$raw"
}

# Print normalized BASE_URL for k6 (from env BASE_URL). Same rules as E2E.
edge_normalize_k6_base_url() {
  local raw="${BASE_URL:-}"
  raw="${raw%/}"
  if [[ -z "$raw" ]]; then
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" =~ ^http://127\.0\.0\.1:4020 ]] || [[ "$raw" =~ ^http://localhost:4020 ]]; then
    echo "⚠️  Ignoring legacy BASE_URL=$raw. Using $EDGE_TEST_DEFAULT_BASE" >&2
    printf '%s\n' "$EDGE_TEST_DEFAULT_BASE"
    return 0
  fi
  if [[ "$raw" != https://* ]]; then
    echo "❌ BASE_URL must be https://… (got: $raw)" >&2
    return 1
  fi
  printf '%s\n' "$raw"
}

edge_hostname_from_https_url() {
  printf '%s\n' "$1" | sed -E 's|^https://([^/:?#]+).*|\1|'
}

# Exit 1 if hostname does not resolve (e.g. missing /etc/hosts → MetalLB).
edge_require_host_resolves() {
  local base="$1"
  local host
  host="$(edge_hostname_from_https_url "$base")"
  if [[ -z "$host" || "$host" == "$base" ]]; then
    echo "❌ Could not parse hostname from $base" >&2
    return 1
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket; socket.gethostbyname(\"$host\")" >/dev/null 2>&1 && return 0
  fi
  if command -v python >/dev/null 2>&1; then
    python -c "import socket; socket.gethostbyname(\"$host\")" >/dev/null 2>&1 && return 0
  fi
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$host" >/dev/null 2>&1 && return 0
  fi
  echo "❌ DNS: cannot resolve $host — add \"<MetalLB_IP> $host\" to /etc/hosts (see: kubectl get svc -n ingress-nginx)" >&2
  return 1
}
