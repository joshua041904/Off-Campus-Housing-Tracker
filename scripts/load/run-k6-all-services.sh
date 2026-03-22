#!/usr/bin/env bash
# Run k6 limit/smoke scripts per housing edge path; export JSON summaries + Markdown + HTML latency chart.
# Includes p(100) thresholds on http_req_duration where applicable.
#
# Env:
#   K6_ALL_SERVICES_OUT   output directory (default bench_logs/k6-all-services-TIMESTAMP under repo)
#   K6_CA_ABSOLUTE        CA pem (default REPO_ROOT/certs/dev-root.pem)
#   BASE_URL              default https://off-campus-housing.test:443 or :30443
#   HOST                  SNI host (default off-campus-housing.test)
#   K6_USE_METALLB        1 = set K6_RESOLVE from ingress-nginx svc caddy-h3 LB IP
#   K6_INSECURE_SKIP_TLS  1 = skip verify (not recommended)
#
# Usage:
#   ./scripts/load/run-k6-all-services.sh
#   K6_CA_ABSOLUTE=$PWD/certs/dev-root.pem ./scripts/load/run-k6-all-services.sh
set -euo pipefail
set -o pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD_DIR="$SCRIPT_DIR"
HOST="${HOST:-off-campus-housing.test}"
K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
OUT="${K6_ALL_SERVICES_OUT:-$REPO_ROOT/bench_logs/k6-all-services-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

export SSL_CERT_FILE="${K6_CA_ABSOLUTE}"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$K6_CA_ABSOLUTE}"

_use_docker_k6() {
  [[ "$(uname -s)" == "Darwin" ]] && [[ "${K6_USE_DOCKER_K6:-0}" == "1" ]] && command -v docker >/dev/null 2>&1
}

_k6() {
  if _use_docker_k6; then
    docker run --rm \
      -v "$REPO_ROOT:$REPO_ROOT" \
      -w "$REPO_ROOT" \
      -e "SSL_CERT_FILE=$K6_CA_ABSOLUTE" \
      -e "K6_TLS_CA_CERT=$K6_TLS_CA_CERT" \
      -e "K6_CA_ABSOLUTE=$K6_CA_ABSOLUTE" \
      -e "BASE_URL=${BASE_URL:-}" \
      -e "K6_RESOLVE=${K6_RESOLVE:-}" \
      -e "K6_INSECURE_SKIP_TLS=${K6_INSECURE_SKIP_TLS:-0}" \
      -e "DURATION=${DURATION:-}" \
      -e "VUS=${VUS:-}" \
      "${K6_DOCKER_IMAGE:-grafana/k6:latest}" \
      k6 "$@"
    return $?
  fi
  if [[ "${1:-}" == "run" ]]; then
    shift
    k6 run \
      -e "BASE_URL=${BASE_URL:-}" \
      -e "K6_RESOLVE=${K6_RESOLVE:-}" \
      -e "K6_TLS_CA_CERT=${K6_TLS_CA_CERT:-}" \
      -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE:-}" \
      -e "K6_INSECURE_SKIP_TLS=${K6_INSECURE_SKIP_TLS:-0}" \
      -e "DURATION=${DURATION:-}" \
      -e "VUS=${VUS:-}" \
      "$@"
    return $?
  fi
  k6 "$@"
}

if [[ "$(uname -s)" == "Darwin" ]] && ! _use_docker_k6; then
  if [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]] && [[ -f "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" ]] && [[ -s "$K6_CA_ABSOLUTE" ]]; then
    "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$K6_CA_ABSOLUTE" || {
      echo "macOS: trust dev-root in keychain or set K6_USE_DOCKER_K6=1 (see scripts/k6-exec-strict-edge.sh)."
      exit 1
    }
  fi
fi

if [[ -z "${BASE_URL:-}" ]]; then
  LB_IP=""
  if [[ "${K6_USE_METALLB:-1}" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
    LB_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  fi
  if [[ -n "$LB_IP" ]]; then
    export BASE_URL="https://${HOST}:443"
    export K6_RESOLVE="${HOST}:443:${LB_IP}"
    echo "MetalLB: BASE_URL=$BASE_URL K6_RESOLVE=$K6_RESOLVE"
  else
    export BASE_URL="${BASE_URL:-https://${HOST}:30443}"
    echo "No LB IP; BASE_URL=$BASE_URL (set K6_RESOLVE manually if needed)"
  fi
else
  export BASE_URL
fi

if [[ ! -f "$K6_CA_ABSOLUTE" ]] || [[ ! -s "$K6_CA_ABSOLUTE" ]]; then
  echo "❌ Missing CA at K6_CA_ABSOLUTE=$K6_CA_ABSOLUTE — set path or run preflight to sync certs/dev-root.pem."
  exit 1
fi

DURATION="${K6_ALL_DURATION:-30s}"
VUS="${K6_ALL_VUS:-8}"
export DURATION VUS

k6_extra=()
[[ "${K6_INSECURE_SKIP_TLS:-0}" == "1" ]] && k6_extra+=(--insecure-skip-tls-verify)

run_one() {
  local name="$1"
  local script="$2"
  local log="$OUT/k6-${name}.log"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " k6 → $name ($script)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if _k6 run "${k6_extra[@]}" --summary-export "$OUT/${name}-summary.json" "$script" 2>&1 | tee "$log"; then
    echo "✅ $name"
  else
    echo "⚠️  $name exited non-zero (see $log)"
  fi
}

if ! _use_docker_k6; then
  command -v k6 >/dev/null 2>&1 || { echo "k6 not installed (or set K6_USE_DOCKER_K6=1)"; exit 1; }
else
  command -v docker >/dev/null 2>&1 || { echo "K6_USE_DOCKER_K6=1 requires Docker"; exit 1; }
fi

run_one "gateway-health" "$LOAD_DIR/k6-gateway-health.js"
run_one "auth-service-health" "$LOAD_DIR/k6-auth-service-health.js"
run_one "listings-health" "$LOAD_DIR/k6-listings-health.js"
run_one "booking-health" "$LOAD_DIR/k6-booking-health.js"
run_one "trust-public" "$LOAD_DIR/k6-trust-public.js"
run_one "analytics-public" "$LOAD_DIR/k6-analytics-public.js"
run_one "messaging" "$LOAD_DIR/k6-messaging.js"
run_one "media-health" "$LOAD_DIR/k6-media-health.js"
run_one "notification-health" "$LOAD_DIR/k6-notification-health.js"
run_one "listings" "$LOAD_DIR/k6-listings.js"
run_one "booking" "$LOAD_DIR/k6-booking.js"
run_one "event-layer-adversarial" "$LOAD_DIR/k6-event-layer-adversarial.js"

echo ""
echo "Aggregating summaries → $OUT/latency-report.md + latency-graph.html"
python3 "$LOAD_DIR/aggregate-k6-summaries.py" "$OUT"

echo ""
echo "Done. Outputs under: $OUT"
