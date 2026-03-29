#!/usr/bin/env bash
# Prove cluster contention during a long suite: periodically append kubectl top to a file.
# Run in a **second terminal** while preflight or run-all-test-suites runs.
#
# Usage:
#   ./scripts/perf/watch-cluster-contention.sh
#   CONTENTION_WATCH_INTERVAL_SEC=5 ./scripts/perf/watch-cluster-contention.sh
#
# Env:
#   CONTENTION_WATCH_LOG     — output file (default bench_logs/cluster-contention-watch-<timestamp>.log under repo root)
#   CONTENTION_WATCH_INTERVAL_SEC — default 8
#   CONTENTION_WATCH_MAX_ITER   — if set, exit after N samples (non-interactive)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INTERVAL="${CONTENTION_WATCH_INTERVAL_SEC:-8}"
OUT="${CONTENTION_WATCH_LOG:-$REPO_ROOT/bench_logs/cluster-contention-watch-$(date +%Y%m%d-%H%M%S).log}"
MAX_ITER="${CONTENTION_WATCH_MAX_ITER:-}"

mkdir -p "$(dirname "$OUT")"
{
  echo "# cluster contention watch — kubectl top samples"
  echo "# interval ${INTERVAL}s"
  echo "# started $(date -Iseconds)"
  echo "# watch for: node CPU%/MEM% >80, pod CPU ~>1000m, postgres/envoy spikes"
} >>"$OUT"

echo "Appending kubectl top every ${INTERVAL}s → $OUT"
echo "Ctrl+C to stop (or set CONTENTION_WATCH_MAX_ITER for batch mode)"

_iter=0
while true; do
  {
    echo ""
    echo "=== $(date -Iseconds) ==="
    echo "--- kubectl top nodes ---"
    kubectl top nodes 2>/dev/null || echo "(kubectl top nodes failed — metrics-server?)"
    echo "--- kubectl top pods -n off-campus-housing-tracker (top 60) ---"
    kubectl top pods -n off-campus-housing-tracker --no-headers 2>/dev/null | head -60 || true
    echo "--- kubectl top pods -n envoy-test ---"
    kubectl top pods -n envoy-test --no-headers 2>/dev/null | head -25 || true
  } >>"$OUT"
  _iter=$((_iter + 1))
  if [[ -n "$MAX_ITER" ]] && [[ "$_iter" -ge "$MAX_ITER" ]]; then
    echo "CONTENTION_WATCH_MAX_ITER=$_iter reached; wrote $OUT"
    exit 0
  fi
  sleep "$INTERVAL"
done
