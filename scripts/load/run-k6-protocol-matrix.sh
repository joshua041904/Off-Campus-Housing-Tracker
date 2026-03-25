#!/usr/bin/env bash
# Sequential k6 runs: TLS ALPN (default), HTTP/1.1 attempt (GODEBUG), HTTP/3 (k6-http3 if present).
# Writes per-protocol summary.json + protocol-comparison.md under protocol-matrix/.
#
# Usage (repo root):
#   SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/load/run-k6-protocol-matrix.sh
#
# Env:
#   PREFLIGHT_RUN_DIR  — if set, matrix goes to $PREFLIGHT_RUN_DIR/protocol-matrix
#   K6_MATRIX_OUT      — override output directory
#   K6_SCRIPT          — default scripts/load/k6-gateway-health.js (alpn + http1); http3 uses k6-gateway-health-http3.js
#   SKIP_HTTP3=1       — skip QUIC leg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$SSL_CERT_FILE}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$SSL_CERT_FILE}"

OUT="${K6_MATRIX_OUT:-}"
if [[ -z "$OUT" ]]; then
  if [[ -n "${PREFLIGHT_RUN_DIR:-}" ]]; then
    OUT="$PREFLIGHT_RUN_DIR/protocol-matrix"
  else
    STAMP=$(date +%Y%m%d-%H%M%S)
    OUT="$REPO_ROOT/bench_logs/run-$STAMP/protocol-matrix"
  fi
fi
mkdir -p "$OUT/alpn" "$OUT/http1" "$OUT/http3"

K6_SCRIPT="${K6_SCRIPT:-$REPO_ROOT/scripts/load/k6-gateway-health.js}"
H3_SCRIPT="$REPO_ROOT/scripts/load/k6-gateway-health-http3.js"
K6_BIN="${K6_BIN:-k6}"
HTTP3_BIN="${K6_HTTP3_BIN:-$REPO_ROOT/.k6-build/bin/k6-http3}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "Protocol matrix → $OUT"
say "1/3 ALPN (stock k6, K6_PROTOCOL=auto)"
K6_PROTOCOL=auto "$K6_BIN" run --summary-export "$OUT/alpn/summary.json" "$K6_SCRIPT" || {
  echo '{"error":"alpn run failed"}' >"$OUT/alpn/summary.json"
}

say "2/3 HTTP/1.1 hint (GODEBUG=http2client=0 + K6_PROTOCOL=http1 — best effort; k6 may still use h2)"
env GODEBUG=http2client=0 K6_PROTOCOL=http1 "$K6_BIN" run --summary-export "$OUT/http1/summary.json" "$K6_SCRIPT" || {
  echo '{"error":"http1 run failed"}' >"$OUT/http1/summary.json"
}

if [[ "${SKIP_HTTP3:-0}" == "1" ]]; then
  echo '{"skipped":true,"reason":"SKIP_HTTP3=1"}' >"$OUT/http3/summary.json"
elif [[ -x "$HTTP3_BIN" ]]; then
  say "3/3 HTTP/3 ($HTTP3_BIN)"
  K6_PROTOCOL=http3 "$HTTP3_BIN" run --summary-export "$OUT/http3/summary.json" "$H3_SCRIPT" || {
    echo '{"error":"http3 run failed"}' >"$OUT/http3/summary.json"
  }
else
  say "3/3 HTTP/3 skipped (build: ./scripts/build-k6-http3.sh → $HTTP3_BIN)"
  echo "{\"skipped\":true,\"reason\":\"missing binary\",\"expected\":\"$HTTP3_BIN\"}" >"$OUT/http3/summary.json"
fi

"$REPO_ROOT/scripts/perf/summarize-protocol-matrix.sh" "$OUT"
say "Done. See $OUT/protocol-comparison.md"
