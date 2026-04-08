#!/usr/bin/env bash
# Run k6-listings-concurrency.js with optional diagnostics when k6 exits non-zero (TCP refused / thresholds).
#
#   SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/load/run-k6-listings-concurrency-instrumented.sh
#   VUS=20 K6_LISTINGS_SCENARIO=arrival ./scripts/load/run-k6-listings-concurrency-instrumented.sh
#   K6_DIAG_ALWAYS=1 — capture kubectl logs even on success
#   K6_DIAG_OUT=/path — output directory (default: REPO_ROOT/bench_logs/k6-listings-diag-TIMESTAMP)
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=k6-edge-load-diagnostics.sh
source "$SCRIPT_DIR/k6-edge-load-diagnostics.sh"

export HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${K6_DIAG_OUT:-$REPO_ROOT/bench_logs/k6-listings-diag-$TS}"
mkdir -p "$OUT"

k6_diag_repo_snippets "$OUT/repo-manifest-snippets.txt"
k6_diag_gateway_ulimit_only "$OUT" "before-k6"

command -v k6 >/dev/null 2>&1 || { echo "k6 not installed"; exit 1; }
export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
[[ -s "$SSL_CERT_FILE" ]] || { echo "SSL_CERT_FILE missing: $SSL_CERT_FILE"; exit 1; }

_k6_rc=0
k6 run "$REPO_ROOT/scripts/load/k6-listings-concurrency.js" "$@" || _k6_rc=$?

if [[ "$_k6_rc" -ne 0 ]] || [[ "${K6_DIAG_ALWAYS:-0}" == "1" ]]; then
  k6_diag_kubectl_snapshots "$OUT" "on-failure"
  [[ "$_k6_rc" -ne 0 ]] && echo "k6 exit $_k6_rc — see $OUT (api-gateway-on-failure.log, caddy-*.log, edge-ulimit-*.txt, repo-manifest-snippets.txt)" >&2
fi

exit "$_k6_rc"
