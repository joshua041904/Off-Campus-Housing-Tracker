#!/usr/bin/env bash
# Pre-install tcpdump in Caddy and Envoy pods so baseline/enhanced/rotation packet capture
# does not block on per-pod install (avoids CAPTURE_INSTALL_TIMEOUT and "tcpdump install timed out").
# Call before step 7 (run all suites) in preflight, or from ensure-ready-for-preflight.sh.
#
# Usage: ./scripts/ensure-tcpdump-in-capture-pods.sh
#   TCPDUMP_INSTALL_TIMEOUT=45  per-pod install cap (default 45s)
#   SKIP_CADDY=1                skip Caddy pods
#   SKIP_ENVOY=1                skip Envoy pod

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

KUBECTL_EXEC_TIMEOUT="${KUBECTL_EXEC_TIMEOUT:-15s}"
_capture_kubectl() { kubectl --request-timeout="$KUBECTL_EXEC_TIMEOUT" "$@"; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

PER_POD_TIMEOUT="${TCPDUMP_INSTALL_TIMEOUT:-45}"
NS_ING="${NS_ING:-ingress-nginx}"
NS_ENVOY="${NS_ENVOY:-envoy-test}"

# Check if pod image is one that already has tcpdump (no install needed).
_image_has_tcpdump() {
  local ns="$1"
  local pod="$2"
  local img
  img=$(_capture_kubectl -n "$ns" get pod "$pod" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || true)
  [[ -z "$img" ]] && return 1
  case "$img" in
    *tcpdump*|*caddy-with-tcpdump*) return 0 ;;
    *) return 1 ;;
  esac
}

# Ensure tcpdump in one pod: if image has tcpdump, verify only; else apk/apt install (capped wait).
_install_in_pod() {
  local ns="$1"
  local pod="$2"
  if _image_has_tcpdump "$ns" "$pod"; then
    if ( KUBECTL_EXEC_TIMEOUT=5s _capture_kubectl -n "$ns" exec "$pod" -- which tcpdump >/dev/null 2>&1 ); then
      info "tcpdump present in $ns/$pod (preinstalled in image); skipping install"
      return 0
    fi
  fi
  ( KUBECTL_EXEC_TIMEOUT="${PER_POD_TIMEOUT}s" _capture_kubectl -n "$ns" exec "$pod" -- sh -c '
    if command -v tcpdump >/dev/null 2>&1; then exit 0; fi
    (apk add --no-cache tcpdump 2>/dev/null) || (apt-get update -qq && apt-get install -y tcpdump 2>/dev/null) || exit 1
    command -v tcpdump
  ' >/dev/null 2>&1 ) &
  local pid=$!
  local waited=0
  while [[ $waited -lt "$PER_POD_TIMEOUT" ]] && kill -0 "$pid" 2>/dev/null; do sleep 2; waited=$((waited + 2)); done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    warn "tcpdump install timed out (${PER_POD_TIMEOUT}s) on $ns/$pod (to avoid: use image with tcpdump, e.g. k3d: scripts/k3d-registry-push-and-patch.sh)"
    return 1
  fi
  wait "$pid" 2>/dev/null || true
  return 0
}

say "=== Ensure tcpdump in capture pods (Caddy + Envoy) ==="
info "Pods using image with tcpdump (e.g. caddy-with-tcpdump) skip install. Others: install cap ${PER_POD_TIMEOUT}s (TCPDUMP_INSTALL_TIMEOUT). To always have tcpdump: use caddy-with-tcpdump image (k3d: scripts/k3d-registry-push-and-patch.sh)."

installed=0
failed=0

# Caddy pods (ingress-nginx; deployment caddy-h3 or label app=caddy-h3)
if [[ "${SKIP_CADDY:-0}" != "1" ]]; then
  say "Caddy pods (namespace $NS_ING)..."
  caddy_pods=()
  while IFS= read -r name; do
    [[ -n "$name" ]] && caddy_pods+=("$name")
  done < <(_capture_kubectl -n "$NS_ING" get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n')
  if [[ ${#caddy_pods[@]} -eq 0 ]]; then
    while IFS= read -r name; do
      [[ -n "$name" ]] && caddy_pods+=("$name")
    done < <(_capture_kubectl -n "$NS_ING" get pods -o name 2>/dev/null | sed 's|pod/||' | grep -E 'caddy-h3|caddy' || true)
  fi
  for pod in "${caddy_pods[@]}"; do
    if _install_in_pod "$NS_ING" "$pod"; then
      ok "Caddy $pod: tcpdump ready"
      installed=$((installed + 1))
    else
      failed=$((failed + 1))
    fi
  done
  [[ ${#caddy_pods[@]} -eq 0 ]] && info "No Caddy pods found in $NS_ING (suites may install tcpdump at capture start)"
fi

# Envoy pod (envoy-test)
if [[ "${SKIP_ENVOY:-0}" != "1" ]]; then
  say "Envoy pod (namespace $NS_ENVOY)..."
  envoy_pod=$(_capture_kubectl -n "$NS_ENVOY" get pods -l app=envoy -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -z "$envoy_pod" ]]; then
    envoy_pod=$(_capture_kubectl -n "$NS_ENVOY" get pods -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  fi
  if [[ -n "$envoy_pod" ]]; then
    if _install_in_pod "$NS_ENVOY" "$envoy_pod"; then
      ok "Envoy $envoy_pod: tcpdump ready"
      installed=$((installed + 1))
    else
      failed=$((failed + 1))
    fi
  else
    info "No Envoy pod found in $NS_ENVOY (optional for capture)"
  fi
fi

say "=== tcpdump ensure complete ==="
if [[ $installed -gt 0 ]]; then
  ok "tcpdump ready in $installed pod(s); baseline/enhanced/rotation capture will skip per-pod install"
fi
[[ $failed -gt 0 ]] && warn "$failed pod(s) timed out or failed; those pods will still get install-at-capture (may hit CAPTURE_INSTALL_TIMEOUT)"
exit 0
