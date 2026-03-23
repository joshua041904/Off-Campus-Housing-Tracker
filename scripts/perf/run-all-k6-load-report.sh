#!/usr/bin/env bash
# Run k6 health/smoke scripts and optional ramp scripts; append Markdown to stdout or a file.
# Requires: k6, certs/dev-root.pem, edge reachable (BASE_URL).
#
# Usage:
#   ./scripts/perf/run-all-k6-load-report.sh >> report.md
#   PERF_APPEND_FILE=report.md ./scripts/perf/run-all-k6-load-report.sh
#
# Env:
#   BASE_URL              default https://off-campus-housing.test
#   K6_CA_ABSOLUTE        default REPO_ROOT/certs/dev-root.pem
#   PERF_QUICK=1          shorter DURATION for health scripts (default 0)
#   PERF_INCLUDE_RAMPS=1  include k6-*-ramp.js (longer; default 0)
#   PERF_SKIP_EVENT_LAYER=1 (default 0)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD="$REPO_ROOT/scripts/load"

K6_CA="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
export SSL_CERT_FILE="$K6_CA"
export K6_TLS_CA_CERT="$K6_CA"
export K6_CA_ABSOLUTE="$K6_CA"
export K6_INSECURE_SKIP_TLS=0
export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"

if [[ ! -s "$K6_CA" ]]; then
  echo "Missing CA: $K6_CA"
  exit 1
fi

if [[ "$(uname -s)" == "Darwin" ]] && [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]] && [[ -f "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" ]]; then
  "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$K6_CA" 2>/dev/null || true
fi

DUR="${K6_PERF_DURATION:-45s}"
VUS="${K6_PERF_VUS:-6}"
if [[ "${PERF_QUICK:-0}" == "1" ]]; then
  DUR="${K6_PERF_QUICK_DURATION:-20s}"
  VUS="${K6_PERF_QUICK_VUS:-4}"
fi
export DURATION="$DUR"
export VUS="$VUS"

_k6() {
  k6 run \
    -e "BASE_URL=${BASE_URL}" \
    -e "K6_TLS_CA_CERT=${K6_TLS_CA_CERT}" \
    -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE}" \
    -e "K6_INSECURE_SKIP_TLS=0" \
    -e "DURATION=${DURATION}" \
    -e "VUS=${VUS}" \
    "$@"
}

emit() {
  if [[ -n "${PERF_APPEND_FILE:-}" ]]; then
    echo "$*" >> "$PERF_APPEND_FILE"
  else
    echo "$*"
  fi
}

{
  echo ""
  echo "# k6 load / smoke (edge)"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "BASE_URL: \`${BASE_URL}\`"
  echo "DURATION: \`${DURATION}\` VUS: \`${VUS}\`"
  echo ""

  run_one() {
    local title="$1"
    local script="$2"
    echo "## k6: $title"
    echo ""
    echo "\`$script\`"
    echo ""
    echo '```'
    if _k6 "$LOAD/$script" 2>&1; then
      :
    else
      echo "(exit non-zero)"
    fi
    echo '```'
    echo ""
  }

  run_one "gateway-health" "k6-gateway-health.js"
  run_one "auth-service-health" "k6-auth-service-health.js"
  run_one "listings-health" "k6-listings-health.js"
  run_one "booking-health" "k6-booking-health.js"
  run_one "trust-public" "k6-trust-public.js"
  run_one "analytics-public" "k6-analytics-public.js"
  run_one "messaging-health" "k6-messaging.js"
  run_one "media-health" "k6-media-health.js"
  run_one "notification-health" "k6-notification-health.js"

  if [[ "${PERF_SKIP_EVENT_LAYER:-0}" != "1" ]]; then
    run_one "event-layer-adversarial" "k6-event-layer-adversarial.js"
  fi

  if [[ "${PERF_INCLUDE_RAMPS:-0}" == "1" ]]; then
    echo "## k6: ramp — listings (arrival-rate)"
    echo ""
    echo '```'
    if _k6 "$LOAD/k6-listings-ramp.js" 2>&1; then :; else echo "(exit non-zero)"; fi
    echo '```'
    echo ""
    echo "## k6: ramp — analytics"
    echo ""
    echo '```'
    if _k6 "$LOAD/k6-analytics-ramp.js" 2>&1; then :; else echo "(exit non-zero)"; fi
    echo '```'
    echo ""
    echo "## k6: ramp — messaging"
    echo ""
    echo '```'
    if _k6 "$LOAD/k6-messaging-ramp.js" 2>&1; then :; else echo "(exit non-zero)"; fi
    echo '```'
    echo ""
  fi

  echo "---"
  echo "End of k6 section."
} | if [[ -n "${PERF_APPEND_FILE:-}" ]]; then tee -a "$PERF_APPEND_FILE"; else cat; fi
