#!/usr/bin/env bash
# Centralized performance report: EXPLAIN all housing DBs + k6 edge smoke (optional ramps).
# Writes one Markdown file under bench_logs/perf-report-<timestamp>/PERF_REPORT.md
#
# Usage:
#   ./scripts/perf/run-perf-full-report.sh
#   PERF_QUICK=1 PERF_INCLUDE_RAMPS=1 ./scripts/perf/run-perf-full-report.sh
#
# Env: see run-all-explain.sh and run-all-k6-load-report.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

STAMP=$(date +%Y%m%d-%H%M%S)
DIR="${PERF_REPORT_DIR:-$REPO_ROOT/bench_logs/perf-report-$STAMP}"
mkdir -p "$DIR"
REPORT="$DIR/PERF_REPORT.md"

{
  echo "# Full performance report (housing)"
  echo ""
  echo "- **Timestamp:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- **Host:** $(hostname 2>/dev/null || echo unknown)"
  echo "- **Repo:** \`$REPO_ROOT\`"
  echo ""
  echo "## Contents"
  echo "1. Postgres EXPLAIN (all service DBs)"
  echo "2. k6 edge load (health + optional ramps)"
  echo ""
} > "$REPORT"

echo "Writing: $REPORT"

# 1) EXPLAIN — append body (skip tee header noise)
bash "$SCRIPT_DIR/run-all-explain.sh" "$DIR/explain-section.md" >/dev/null || true
if [[ -f "$DIR/explain-section.md" ]]; then
  cat "$DIR/explain-section.md" >> "$REPORT"
  echo "" >> "$REPORT"
fi

# 2) k6
export PERF_APPEND_FILE="$REPORT"
bash "$SCRIPT_DIR/run-all-k6-load-report.sh" || true
unset PERF_APPEND_FILE

echo ""
echo "Done."
echo "  $REPORT"
echo "  (companion: $DIR/explain-section.md)"
