#!/usr/bin/env bash
# Cross-service performance analysis: run each edge k6 script in **isolation** with
# kubectl top snapshots + cooldowns, export per-script JSON summaries, then aggregate.
#
# Use this to compare against the full back-to-back grid (run-housing-k6-edge-smoke.sh /
# preflight 7a): if tails disappear here but show up in the suite, contention/order effects
# are likely — see docs/perf/TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md
#
# Requirements: k6, kubectl (metrics-server for top), certs/dev-root.pem, edge DNS.
#
# Usage (repo root):
#   SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/perf/run-k6-cross-service-isolation.sh
#
# Env:
#   K6_ISO_OUT                 — output dir (default bench_logs/k6-cross-service-<timestamp>)
#   K6_ISO_POST_COOLDOWN_SEC   — sleep after each script (default 25)
#   K6_ISO_CAR_EXTRA_SEC       — extra sleep after constant-arrival-rate scripts (default 20)
#   K6_ISO_DURATION / VUS      — default 22s / 5 for health grid rows
#   K6_ISO_SKIP_JWT            — 1 = skip k6-booking.js + k6-search-watchlist.js
#   K6_ISO_SKIP_ANALYTICS_FEEL — 1 = skip k6-analytics-listing-feel.js
#   SKIP_MACOS_DEV_CA_TRUST    — same as other k6 scripts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOAD="$REPO_ROOT/scripts/load"
cd "$REPO_ROOT"

# shellcheck source=../lib/edge-test-url.sh
source "$REPO_ROOT/scripts/lib/edge-test-url.sh"

[[ "${SKIP_K6_ISO:-0}" == "1" ]] && { echo "SKIP_K6_ISO=1 — exit"; exit 0; }

command -v k6 >/dev/null 2>&1 || { echo "k6 not on PATH"; exit 1; }

export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
export K6_INSECURE_SKIP_TLS=0
BASE_URL="$(edge_normalize_k6_base_url)" || exit 1
export BASE_URL
edge_require_host_resolves "$BASE_URL" || exit 1

CA="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export SSL_CERT_FILE="$CA"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$CA}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$CA}"
[[ -s "$SSL_CERT_FILE" ]] || { echo "SSL_CERT_FILE missing or empty: $SSL_CERT_FILE"; exit 1; }

if [[ "$(uname -s)" == "Darwin" ]] && [[ "${SKIP_MACOS_DEV_CA_TRUST:-0}" != "1" ]] && [[ -f "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" ]]; then
  "$REPO_ROOT/scripts/lib/trust-dev-root-ca-macos.sh" "$K6_CA_ABSOLUTE" || {
    echo "macOS: trust dev CA or SKIP_MACOS_DEV_CA_TRUST=1"
    exit 1
  }
fi

OUT="${K6_ISO_OUT:-$REPO_ROOT/bench_logs/k6-cross-service-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
: >"$OUT/cluster-snapshots.log"
: >"$OUT/MANIFEST.txt"

POST="${K6_ISO_POST_COOLDOWN_SEC:-25}"
CAR_EXTRA="${K6_ISO_CAR_EXTRA_SEC:-20}"
DUR="${K6_ISO_DURATION:-22s}"
VUS="${K6_ISO_VUS:-5}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

iso_snapshot() {
  local tag="$1"
  {
    echo ""
    echo "=== ${tag} $(date -Iseconds) ==="
    kubectl top nodes 2>/dev/null || echo "(kubectl top nodes unavailable)"
    echo "--- pods off-campus-housing-tracker (top 50) ---"
    kubectl top pods -n off-campus-housing-tracker --no-headers 2>/dev/null | head -50 || echo "(unavailable)"
    echo "--- pods envoy-test (top 20) ---"
    kubectl top pods -n envoy-test --no-headers 2>/dev/null | head -20 || true
  } >>"$OUT/cluster-snapshots.log"
}

# $1 name, $2 script, $3 is_car, $4 duration (optional), $5 vus (optional)
iso_run() {
  local name="$1"
  local file="$2"
  local is_car="${3:-0}"
  local dur="${4:-$DUR}"
  local vus="${5:-$VUS}"
  local log="$OUT/k6-${name}.log"
  local summary="$OUT/${name}-summary.json"
  echo "$name $file car=${is_car} DURATION=${dur} VUS=${vus}" >>"$OUT/MANIFEST.txt"
  say "Isolation: $name ($file) DURATION=${dur} VUS=${vus}"
  iso_snapshot "BEFORE ${name}"
  export DURATION="$dur" VUS="$vus"
  set +e
  k6 run \
    -e "BASE_URL=${BASE_URL}" \
    -e "K6_TLS_CA_CERT=${K6_TLS_CA_CERT}" \
    -e "K6_CA_ABSOLUTE=${K6_CA_ABSOLUTE}" \
    -e "K6_INSECURE_SKIP_TLS=0" \
    -e "DURATION=${DURATION:-}" \
    -e "VUS=${VUS:-}" \
    --summary-export "$summary" \
    "$LOAD/$file" 2>&1 | tee "$log"
  local rc=$?
  set -e
  iso_snapshot "AFTER ${name}"
  echo "  post cooldown ${POST}s"
  sleep "$POST"
  if [[ "$is_car" == "1" ]]; then
    echo "  CAR extra cooldown ${CAR_EXTRA}s"
    sleep "$CAR_EXTRA"
  fi
  [[ "$rc" -ne 0 ]] && echo "⚠️  $name exited $rc (see $log)"
  return 0
}

say "k6 cross-service isolation matrix → $OUT"
say "BASE_URL=$BASE_URL POST_COOLDOWN=${POST}s CAR_EXTRA=${CAR_EXTRA}s DUR=$DUR VUS=$VUS"

# Order matches run-housing-k6-edge-smoke.sh (third field: 1 = constant-arrival-rate)
for triple in \
  "gateway-health:k6-gateway-health.js:0" \
  "auth-health:k6-auth-service-health.js:0" \
  "listings-health:k6-listings-health.js:0" \
  "booking-health:k6-booking-health.js:0" \
  "trust-public:k6-trust-public.js:0" \
  "analytics-public:k6-analytics-public.js:0" \
  "messaging:k6-messaging.js:1" \
  "media-health:k6-media-health.js:1" \
  "event-layer-adversarial:k6-event-layer-adversarial.js:0"; do
  name="${triple%%:*}"
  rest="${triple#*:}"
  is_car="${rest##*:}"
  file="${rest%:*}"
  iso_run "$name" "$file" "$is_car"
done

if [[ "${K6_ISO_SKIP_ANALYTICS_FEEL:-0}" != "1" ]]; then
  iso_run "analytics-listing-feel" "k6-analytics-listing-feel.js" 0 \
    "${K6_ISO_ANALYTICS_FEEL_DURATION:-45s}" "${K6_ISO_ANALYTICS_FEEL_VUS:-2}"
fi

if [[ "${K6_ISO_SKIP_JWT:-0}" != "1" ]]; then
  iso_run "booking-jwt" "k6-booking.js" 0 \
    "${K6_ISO_BOOKING_DURATION:-25s}" "${K6_ISO_BOOKING_VUS:-3}"
  iso_run "search-watchlist" "k6-search-watchlist.js" 0 \
    "${K6_ISO_SEARCH_DURATION:-25s}" "${K6_ISO_SEARCH_VUS:-6}"
fi

say "Aggregating *-summary.json → latency-report.md + latency-graph.html"
if [[ -f "$LOAD/aggregate-k6-summaries.py" ]]; then
  python3 "$LOAD/aggregate-k6-summaries.py" "$OUT"
else
  echo "⚠️  aggregate-k6-summaries.py missing"
fi

say "Done."
echo "  Directory: $OUT"
echo "  Read:      $OUT/latency-report.md"
echo "  Snapshots: $OUT/cluster-snapshots.log"
echo "  Order:     $OUT/MANIFEST.txt"
