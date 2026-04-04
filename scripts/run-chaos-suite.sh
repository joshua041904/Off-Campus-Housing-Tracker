#!/usr/bin/env bash
# Orchestrate resilience checks and optional chaos scenarios (safe by default).
#
#   ./scripts/run-chaos-suite.sh              # creates artifact dir + verify-only + report
#   CHAOS_SUITE=full CHAOS_CONFIRM_COLIMA_REBOOT=1 ./scripts/run-chaos-suite.sh  # includes colima reboot
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

STAMP="$(date +%Y%m%d-%H%M%S)"
ART="${CHAOS_SUITE_ARTIFACT_DIR:-$REPO_ROOT/bench_logs/chaos-suite-$STAMP}"
mkdir -p "$ART"
export CHAOS_ARTIFACT_DIR="$ART"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "=== Chaos suite artifact: $ART ==="

# Baseline read-only checks (non-fatal)
if kubectl get ns off-campus-housing-tracker >/dev/null 2>&1; then
  kubectl get pods -A -o wide 2>&1 | tee "$ART/pods-snapshot.txt" || true
  kubectl get events -A --sort-by='.lastTimestamp' 2>&1 | tail -100 | tee "$ART/events-tail.txt" || true
else
  echo "cluster not reachable — skipping kubectl snapshots" | tee "$ART/SKIPPED-kubectl.txt"
fi

if [[ -f "$REPO_ROOT/scripts/verify-kafka-cluster.sh" ]] && kubectl get ns off-campus-housing-tracker >/dev/null 2>&1; then
  say "Running verify-kafka-cluster.sh (best-effort)…"
  bash "$REPO_ROOT/scripts/verify-kafka-cluster.sh" 2>&1 | tee "$ART/verify-kafka-cluster.log" || true
fi

if [[ "${CHAOS_SUITE:-baseline}" == "full" ]]; then
  say "CHAOS_SUITE=full: optional node reboot…"
  bash "$SCRIPT_DIR/chaos-node-reboot.sh" 2>&1 | tee "$ART/chaos-node-reboot.log" || true
  bash "$SCRIPT_DIR/chaos-kafka-partition.sh" 2>&1 | tee "$ART/chaos-kafka-partition.log" || true
  bash "$SCRIPT_DIR/chaos-expired-ca.sh" 2>&1 | tee "$ART/chaos-expired-ca.log" || true
  bash "$SCRIPT_DIR/chaos-latency.sh" 2>&1 | tee "$ART/chaos-latency.log" || true
fi

# Kafka ↔ MetalLB alignment chaos (destructive — needs CHAOS_CONFIRM + KAFKA_ALIGNMENT_TEST_MODE).
if [[ "${CHAOS_SUITE:-baseline}" == *kafka* ]] || [[ "${CHAOS_KAFKA_ALIGNMENT:-0}" == "1" ]]; then
  say "Chaos: Kafka alignment stochastic (CHAOS_CONFIRM + KAFKA_ALIGNMENT_TEST_MODE required)…"
  chmod +x "$SCRIPT_DIR/chaos-kafka-alignment-stochastic.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/chaos-kafka-alignment-stochastic.sh" 2>&1 | tee "$ART/chaos-kafka-alignment-stochastic.log" || true
fi

python3 "$SCRIPT_DIR/generate-chaos-report.py" --dir "$ART" --scenario "chaos-suite ${CHAOS_SUITE:-baseline}" || true
say "Done. Report: $ART/chaos-report.md"
