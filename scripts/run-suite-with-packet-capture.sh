#!/usr/bin/env bash
# Run any test script while capturing on Caddy + Envoy pods (same pattern as test-packet-capture-standalone.sh).
# Use for protocol evidence alongside suite-specific assertions.
#
# Usage:
#   ./scripts/run-suite-with-packet-capture.sh ./scripts/test-listings-http2-http3.sh
#
# Env: HOST, PORT, TARGET_IP, CAPTURE_* , HOUSING_NS (default off-campus-housing-tracker), DISABLE_PACKET_CAPTURE=1 to skip capture
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }
[[ -f "$SCRIPT_DIR/lib/packet-capture.sh" ]] && . "$SCRIPT_DIR/lib/packet-capture.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
NS="$HOUSING_NS"
export NS HOUSING_NS

_kb() {
  local ctx
  ctx=$(kubectl config current-context 2>/dev/null || echo "")
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

if ! _kb get ns ingress-nginx >/dev/null 2>&1; then
  warn "Cluster not reachable; running suite without capture"
  exec "$@"
fi

export CAPTURE_RUN_TYPE="${CAPTURE_RUN_TYPE:-suite-$(basename "$1" .sh)}"

init_capture_session
export CAPTURE_DRAIN_SECONDS="${CAPTURE_DRAIN_SECONDS:-5}"
export CAPTURE_COPY_DIR="$(packet_capture_dir)"

caddy_pods=$(_kb -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
envoy_pod=$(_kb -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
envoy_ns="envoy-test"
[[ -z "$envoy_pod" ]] && envoy_pod=$(_kb -n ingress-nginx get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null) && envoy_ns="ingress-nginx"

for p in $caddy_pods; do
  ok "Capture Caddy $p"
  if [[ "${PORT:-30443}" == "443" ]] && [[ "${CAPTURE_STRICT_ENDPOINT_BPF:-1}" != "0" ]]; then
    start_capture "ingress-nginx" "$p" ""
  else
    start_capture "ingress-nginx" "$p" "port ${PORT:-30443} or port 443 or port 30443 or udp port 443"
  fi
done
[[ -n "$envoy_pod" ]] && ok "Capture Envoy $envoy_pod" && start_capture "$envoy_ns" "$envoy_pod" "port 10000 or port 30000 or portrange 50051-50068"

sleep 3
say "Running: $*"
suite_exit=0
"$@" || suite_exit=$?

sleep "${CAPTURE_POST_SUITE_SLEEP:-4}"
say "Stopping packet capture (suite wrapper)…"
LOG="/tmp/packet-capture-suite-${CAPTURE_RUN_TYPE}-$$.log"
stop_and_analyze_captures 1 2>&1 | tee "$LOG" || true
ok "Capture log: $LOG"

exit "$suite_exit"
