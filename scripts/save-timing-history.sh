#!/usr/bin/env bash
# Append a snapshot of bench_logs/bootstrap_phase_timings.json for offline averaging.
# Env: VERIFY_BOOTSTRAP_TIMING_JSON — override timings path (default: bench_logs/bootstrap_phase_timings.json).
# Env: VERIFY_BOOTSTRAP_TIMING_HISTORY_DIR — override dir (default: bench_logs/historical_timings).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SRC="${VERIFY_BOOTSTRAP_TIMING_JSON:-$ROOT/bench_logs/bootstrap_phase_timings.json}"
DIR="${VERIFY_BOOTSTRAP_TIMING_HISTORY_DIR:-$ROOT/bench_logs/historical_timings}"

[[ -f "$SRC" ]] || exit 0

mkdir -p "$DIR"
DEST="$DIR/run-$(date +%s)-$$.json"
cp "$SRC" "$DEST"
echo "$DEST"
