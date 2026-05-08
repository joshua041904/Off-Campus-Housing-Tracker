#!/usr/bin/env bash
# Optional chaos / resilience probe placeholder for Coverage Model v2.
# Emits bench_logs/coverage-chaos.json; does not mutate the cluster unless CHAOS_VERIFY_RUN=1 (future).
#
# Env: CHAOS_VERIFY_RUN — default 0 (writes skipped stub only)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${COVERAGE_CHAOS_OUT:-$REPO/bench_logs/coverage-chaos.json}"
mkdir -p "$(dirname "$OUT")"

if [[ "${CHAOS_VERIFY_RUN:-0}" == "1" ]]; then
  echo "❌ CHAOS_VERIFY_RUN=1 not implemented yet — set 0 or extend this script." >&2
  exit 1
fi

node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({specVersion:'och-coverage-chaos-v1',skipped:true,reason:'CHAOS_VERIFY_RUN!=1 (opt-in only)',brokerKillTest:false,outboxRecovered:false,gatewayStable:false,generatedAt:new Date().toISOString()},null,2)+'\n')" "$OUT"
echo "Wrote stub $OUT (chaos verify opt-in)"
