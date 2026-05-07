#!/usr/bin/env bash
# Validate PHASE against adaptive/static linear order, then print (extend for real work).
# Env: BOOTSTRAP_ORDER_FILE, BOOTSTRAP_GRAPH, VERIFY_BOOTSTRAP_PROGRESS — overrides (defaults under repo root).
# Usage: run-phase.sh A.workspace   OR   make run-phase PHASE=A.workspace
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PHASE="${1:?phase argument required}"

ORDER_FILE="${BOOTSTRAP_ORDER_FILE:-$ROOT/bench_logs/bootstrap_optimized_order.json}"
GRAPH="${BOOTSTRAP_GRAPH:-$ROOT/infra/bootstrap_invariants.graph.json}"
PROGRESS="${VERIFY_BOOTSTRAP_PROGRESS:-$ROOT/bench_logs/bootstrap_state_progress.json}"

node "$ROOT/scripts/validate-phase-order.mjs" \
  --phase "$PHASE" \
  --order-file "$ORDER_FILE" \
  --graph "$GRAPH" \
  --progress "$PROGRESS"

echo "▶ Running $PHASE (extend scripts/run-phase.sh to invoke verify scripts per phase)"
