#!/usr/bin/env bash
# Operator playbook: artifact presence, jq spot-checks, automated readiness gate.
# Does NOT run make capacity-one (cluster + long ceiling required) — run that separately.
#
# Usage (repo root):
#   ./scripts/protocol/validate-production-readiness.sh
#   PERF_DIR=bench_logs/performance-lab ./scripts/protocol/validate-production-readiness.sh
#   ./scripts/protocol/validate-production-readiness.sh --fixture   # CI smoke against checked-in JSON
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PERF_DIR="${PERF_DIR:-$REPO_ROOT/bench_logs/performance-lab}"
FIXTURE=0
if [[ "${1:-}" == "--fixture" ]]; then
  FIXTURE=1
  PERF_DIR="$SCRIPT_DIR/fixtures/perf-lab-pass"
fi

echo "=== Phase 0 — artifacts ($PERF_DIR) ==="
for f in protocol-happiness-matrix.json protocol-superiority-scores.json collapse-summary.json capacity-recommendations.json; do
  if [[ -f "$PERF_DIR/$f" ]]; then
    echo "  ok: $f"
  else
    echo "  missing: $f (capacity-recommendations optional for happiness; required for full lab)"
  fi
done

if [[ ! -f "$PERF_DIR/protocol-happiness-matrix.json" ]] || [[ ! -f "$PERF_DIR/protocol-superiority-scores.json" ]] || [[ ! -f "$PERF_DIR/collapse-summary.json" ]]; then
  echo "STOP: run make capacity-one (or copy artifacts into PERF_DIR)."
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  echo ""
  echo "=== Phase 1 — utilization + tau (jq) ==="
  jq '.rows[] | {service, winner_utilization_pool_10, transport_gain_tau, h3_transport_unlocked, recommended_pool, pool_threshold_ceil}' "$PERF_DIR/protocol-happiness-matrix.json"
  echo ""
  echo "=== Phase 2 — sample service row ==="
  if [[ "$FIXTURE" -eq 1 ]]; then
    jq '.rows[] | select(.service=="fixture-service")' "$PERF_DIR/protocol-happiness-matrix.json"
  else
    jq '.rows[] | select(.service=="analytics")' "$PERF_DIR/protocol-happiness-matrix.json" 2>/dev/null || true
  fi
else
  echo "(install jq for Phase 1–2 table output)"
fi

echo ""
echo "=== Automated gate: declare-readiness.js ==="
if [[ "$FIXTURE" -eq 1 ]]; then
  node "$SCRIPT_DIR/declare-readiness.js" --perf-dir "$PERF_DIR"
else
  node "$SCRIPT_DIR/declare-readiness.js" --perf-dir "$PERF_DIR" || {
    echo ""
    echo "Gate failed on real lab data — expected until pools/utilization are tuned."
    echo "Use --fixture for a passing smoke, or tighten backend then re-run make capacity-one."
    exit 1
  }
fi

echo ""
echo "=== Strict envelope (lab vs infra/k8s/base/config/strict-envelope.json) ==="
if [[ "$FIXTURE" -eq 1 ]]; then
  node "$SCRIPT_DIR/strict-envelope-check.js" \
    --perf-dir "$PERF_DIR" \
    --envelope "$SCRIPT_DIR/fixtures/strict-envelope-ci.json" \
    --require-lab
else
  node "$SCRIPT_DIR/strict-envelope-check.js" --perf-dir "$PERF_DIR" || {
    echo "Strict envelope failed — update strict-envelope.json / cluster or refresh lab (see Makefile strict-envelope-check)."
    exit 1
  }
fi

echo ""
echo "Done. Optional: node $SCRIPT_DIR/build-envelope-dashboard.js --perf-dir \"$PERF_DIR\""
echo "Optional: node $SCRIPT_DIR/build-dominance-heatmap.js --service-model <ceiling>/service-model.json --out-dir \"$PERF_DIR\""
