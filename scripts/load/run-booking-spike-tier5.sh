#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${K6_SPIKE_OUT_DIR:-$REPO_ROOT/bench_logs/k6-booking-spike-tier5-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT_DIR"

K6_SCRIPT="$SCRIPT_DIR/k6-booking-spike-tier5.js"
SUMMARY_JSON="$OUT_DIR/summary.json"
SUMMARY_TXT="$OUT_DIR/summary.txt"

echo "[k6-tier5] output: $OUT_DIR"
echo "[k6-tier5] script: $K6_SCRIPT"

k6 run \
  --summary-export "$SUMMARY_JSON" \
  "$K6_SCRIPT" | tee "$SUMMARY_TXT"

echo "[k6-tier5] finished"
echo "[k6-tier5] summary: $SUMMARY_JSON"
