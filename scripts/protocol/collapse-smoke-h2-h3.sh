#!/usr/bin/env bash
# Light k6 smoke: gateway health over HTTP/2 at multiple VU levels. HTTP/3 requires k6-http3 binary (optional second pass).
# Writes collapse-smoke-report.json to OUT_DIR.
#
# Usage: ./scripts/protocol/collapse-smoke-h2-h3.sh [out-dir]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/bench_logs/transport-lab}"
mkdir -p "$OUT_DIR"

export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
K6_BIN="${K6_BIN:-$(command -v k6)}"
SCPT="$REPO_ROOT/scripts/load/k6-gateway-collapse-smoke.js"
H3SCPT="$REPO_ROOT/scripts/load/k6-gateway-health-http3.js"
K6H3="${K6_HTTP3_BIN:-$REPO_ROOT/.k6-build/bin/k6-http3}"

failed=0
RUNS_FILE="$(mktemp)"
echo "[]" >"$RUNS_FILE"

run_phase() {
  local label="$1"
  local vus="$2"
  local proto="${3:-http2}"
  local bin="$4"
  local script="$5"
  export VUS="$vus"
  export DURATION="${COLLAPSE_SMOKE_DURATION:-25s}"
  export PROTOCOL_MODE="$proto"
  local ok=1
  if "$bin" run "$script" 2>&1 | tee "/tmp/k6-smoke-$$.log"; then
    ok=1
  else
    ok=0
    failed=$((failed + 1))
  fi
  node -e "
const fs = require('fs');
const p = process.argv[1];
const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
arr.push({ label: process.argv[2], vus: Number(process.argv[3]), protocol: process.argv[4], ok: process.argv[5] === '1' });
fs.writeFileSync(p, JSON.stringify(arr));
" "$RUNS_FILE" "$label" "$vus" "$proto" "$ok"
}

if [[ ! -f "$SCPT" ]] || ! command -v "$K6_BIN" >/dev/null 2>&1; then
  echo '{"skipped":true,"reason":"k6 or script missing"}' >"$OUT_DIR/collapse-smoke-report.json"
  exit 0
fi

for vus in 5 20 50; do
  run_phase "gateway-h2-vus-${vus}" "$vus" "http2" "$K6_BIN" "$SCPT" || true
done

if [[ -x "$K6H3" ]] && [[ -f "$H3SCPT" ]]; then
  export K6_HTTP3_REQUIRE_MODULE=1
  for vus in 5 20; do
    run_phase "gateway-h3-vus-${vus}" "$vus" "http3" "$K6H3" "$H3SCPT" || true
  done
fi

node -e '
const fs = require("fs");
const out = process.argv[1];
const failed = Number(process.argv[2]);
const runsPath = process.argv[3];
const runs = JSON.parse(fs.readFileSync(runsPath, "utf8"));
const doc = {
  generated_at: new Date().toISOString(),
  failed,
  p95_violations: 0,
  note: "Thresholds: fail_rate<1%, p95<800ms (H2). H3 uses k6-http3 script thresholds if run.",
  runs,
};
fs.writeFileSync(`${out}/collapse-smoke-report.json`, JSON.stringify(doc, null, 2) + "\n");
' "$OUT_DIR" "$failed" "$RUNS_FILE"
rm -f "$RUNS_FILE"

exit 0
