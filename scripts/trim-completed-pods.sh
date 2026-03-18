#!/usr/bin/env bash
# Trim Failed and Succeeded pods cluster-wide to reduce API server load.
# Run only when cluster is reachable. Capped at TRIM_CAP seconds (default 15).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
TRIM_CAP="${TRIM_CAP:-15}"

_run_trim() {
  local f s
  f=$(kubectl get pods -A --field-selector=status.phase=Failed --no-headers 2>/dev/null | wc -l | tr -d ' ')
  s=$(kubectl get pods -A --field-selector=status.phase=Succeeded --no-headers 2>/dev/null | wc -l | tr -d ' ')
  [[ "$f" -gt 0 ]] || [[ "$s" -gt 0 ]] && echo "  Bloat: $f Failed, $s Succeeded pods (trimming...)"
  kubectl delete pods -A --field-selector=status.phase=Failed --request-timeout=10s --ignore-not-found 2>/dev/null || true
  kubectl delete pods -A --field-selector=status.phase=Succeeded --request-timeout=10s --ignore-not-found 2>/dev/null || true
}

( _run_trim ) & pid=$!
( sleep "$TRIM_CAP"; kill -9 $pid 2>/dev/null ) & kpid=$!
wait $pid 2>/dev/null || true
kill $kpid 2>/dev/null || true
wait $kpid 2>/dev/null || true
