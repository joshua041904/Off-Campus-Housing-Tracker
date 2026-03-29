#!/usr/bin/env bash
# Canonical OCH transport certification (deterministic order). Repo root as cwd.
# 1) Regenerate protocol matrix CSV + anomalies (CSV fallback when run-*/protocol-matrix is missing).
# 2) Fail if any_http2_collapse_anomaly is true.
# 3) Unit tests → strict Playwright → transport-lab → declare-readiness --strict-quic.
#
# In GitHub Actions (CI=true), cluster steps are skipped: no e2e against private edge, no transport-lab.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Local full certification assumes Docker (compose / cluster tooling). Skip when CI=true (structural slice only).
if [[ "${CI:-}" != "true" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker not available. Full certification requires local cluster."
    exit 1
  fi
fi

SKIP_CLUSTER_STEPS=
if [[ "${CI:-}" == "true" ]]; then
  echo "Running in CI — skipping Playwright strict, transport-lab, and declare-readiness (require cluster / MetalLB)."
  SKIP_CLUSTER_STEPS=1
fi

echo "== 1) extract-protocol-matrix (EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1) =="
export EXTRACT_PROTOCOL_MATRIX_FROM_CSV=1
node scripts/perf/extract-protocol-matrix.js

ANOM="${ROOT}/bench_logs/performance-lab/protocol-matrix-anomalies.json"
if [[ ! -f "$ANOM" ]]; then
  echo "FAIL: missing ${ANOM}"
  exit 1
fi
echo "== protocol-matrix-anomalies.json =="
cat "$ANOM"

if grep -q '"any_http2_collapse_anomaly": true' "$ANOM"; then
  echo "FAIL: HTTP/2 matrix collapse (any_http2_collapse_anomaly=true). Stop — tune transport/DB pools, then re-run."
  exit 1
fi
if ! grep -q '"any_http2_collapse_anomaly": false' "$ANOM"; then
  echo "FAIL: expected boolean any_http2_collapse_anomaly in ${ANOM}"
  exit 1
fi

echo "== 2) pnpm test =="
pnpm test

if [[ -n "${SKIP_CLUSTER_STEPS:-}" ]]; then
  echo "OK: CI certification slice passed (matrix anomaly gate + unit tests only)."
  exit 0
fi

echo "== 3) strict Playwright (verticals + system integrity) =="
(
  cd webapp
  pnpm run test:e2e:strict-verticals-and-integrity
)

echo "== 4) make transport-lab =="
make transport-lab

FA="${ROOT}/bench_logs/transport-lab/final-transport-artifact.json"
if [[ ! -f "$FA" ]]; then
  echo "FAIL: missing ${FA}"
  exit 1
fi

echo "== 5) declare-readiness --strict-quic =="
set +e
out="$(node scripts/protocol/declare-readiness.js \
  --perf-dir bench_logs/performance-lab \
  --transport-artifact bench_logs/transport-lab/final-transport-artifact.json \
  --strict-quic 2>&1)"
code=$?
set -e
printf '%s\n' "$out"
if [[ "$code" -ne 0 ]]; then
  echo "FAIL: declare-readiness exited $code"
  exit "$code"
fi
if ! printf '%s\n' "$out" | grep -q '^PRODUCTION_READY=true$'; then
  echo "FAIL: expected PRODUCTION_READY=true on stdout"
  exit 1
fi

echo "OK: full certification passed."
