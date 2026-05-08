#!/usr/bin/env bash
# Emit bench_logs/coverage-transport.json with observed H1/H2/H3 (och-transport-v2).
# Stock k6 runs H1/H2 checks; HTTP/3 requires .k6-build/k6-http3 (optional — h3.observed false if missing).
# H1: GODEBUG_TRANSPORT_H1=http2client=0 (default) disables Go HTTP/2 client so ALPN cannot mask as HTTP/2 when probing H1.
#
# Env: BASE_URL, SSL_CERT_FILE, K6_X_SUITE, K6_HTTP3_BIN (default $REPO/.k6-build/k6-http3)
# Skip: SKIP_TRANSPORT_V2=1
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"
export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO/certs/dev-root.pem}"
export BASE_URL="${BASE_URL:-https://off-campus-housing.test}"
export K6_X_SUITE="${K6_X_SUITE:-k6}"
OUT="${COVERAGE_TRANSPORT_OUT:-$REPO/bench_logs/coverage-transport.json}"
mkdir -p "$(dirname "$OUT")"

if [[ "${SKIP_TRANSPORT_V2:-0}" == "1" ]]; then
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({specVersion:'och-transport-v2',note:'SKIP_TRANSPORT_V2=1',h1:{observed:false},h2:{observed:false},h3:{observed:false},generatedAt:new Date().toISOString(),verifiedBy:'skipped'},null,2)+'\n')" "$OUT"
  echo "ℹ️  SKIP_TRANSPORT_V2=1 — wrote stub $OUT (transport score 0 in model)"
  exit 0
fi

h1_ok=0
h2_ok=0
h3_ok=0

if command -v k6 >/dev/null 2>&1; then
  # Go’s HTTP client upgrades to H2 when ALPN offers it; disable client HTTP/2 so k6 reports HTTP/1.1 (HAProxy/Caddy often prefer H2).
  if GODEBUG="${GODEBUG_TRANSPORT_H1:-http2client=0}" k6 run "$REPO/scripts/load/k6-transport-h1.js"; then h1_ok=1; fi
  if k6 run "$REPO/scripts/load/k6-transport-h2.js"; then h2_ok=1; fi
  K6H3="${K6_HTTP3_BIN:-$REPO/.k6-build/k6-http3}"
  if [[ -x "$K6H3" ]]; then
    if K6_HTTP3_REQUIRE_MODULE=1 "$K6H3" run "$REPO/scripts/load/k6-transport-h3.js"; then h3_ok=1; fi
  else
    echo "ℹ️  HTTP/3 binary not executable at $K6H3 — h3.observed=false (build: bash scripts/build-k6-http3.sh)" >&2
  fi
else
  echo "ℹ️  k6 not on PATH — transport v2 marks H1/H2/H3 unobserved" >&2
fi

node -e "
const fs = require('fs');
const [out, a, b, c] = process.argv.slice(1);
const doc = {
  specVersion: 'och-transport-v2',
  generatedAt: new Date().toISOString(),
  verifiedBy: 'k6-protocol-observation',
  h1: { observed: a === '1' },
  h2: { observed: b === '1' },
  h3: { observed: c === '1' },
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\\n');
" "$OUT" "$h1_ok" "$h2_ok" "$h3_ok"

echo "Wrote $OUT (h1=$h1_ok h2=$h2_ok h3=$h3_ok)"
