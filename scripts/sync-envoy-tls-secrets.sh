#!/usr/bin/env bash
# Copy dev-root-ca into envoy-test so Envoy can verify upstream (backend) TLS.
# Source: ingress-nginx (edge/Caddy stack) or off-campus-housing-tracker as fallback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS_ENVOY="${NS_ENVOY:-envoy-test}"
NS_APP="${NS_APP:-off-campus-housing-tracker}"
NS_ING="${NS_ING:-ingress-nginx}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

_k() {
  kubectl --request-timeout=25s "$@"
}

_find_dev_root_source_ns() {
  if _k get secret dev-root-ca -n "$NS_ING" -o name &>/dev/null; then
    echo "$NS_ING"
    return 0
  fi
  if _k get secret dev-root-ca -n "$NS_APP" -o name &>/dev/null; then
    echo "$NS_APP"
    return 0
  fi
  return 1
}

say "=== Sync dev-root-ca → $NS_ENVOY ==="

if ! _k get ns "$NS_ENVOY" -o name &>/dev/null; then
  warn "Namespace $NS_ENVOY not found; skip Envoy TLS sync"
  exit 0
fi

SRC_NS="$(_find_dev_root_source_ns)" || {
  warn "dev-root-ca not found in $NS_ING or $NS_APP; cannot sync to $NS_ENVOY"
  exit 1
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Strip cluster metadata; set target namespace (requires jq).
if ! command -v jq &>/dev/null; then
  warn "jq not found; install jq to run sync-envoy-tls-secrets.sh"
  exit 1
fi

_k get secret dev-root-ca -n "$SRC_NS" -o json |
  jq --arg ns "$NS_ENVOY" '
    del(.metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp, .metadata.managedFields) |
    .metadata = {name: "dev-root-ca", namespace: $ns}
  ' >"$tmp"

_k apply -f "$tmp"
ok "dev-root-ca copied from namespace $SRC_NS → $NS_ENVOY"
exit 0
