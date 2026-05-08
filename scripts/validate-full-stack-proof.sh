#!/usr/bin/env bash
# validate-full-stack-proof.sh — meta orchestrator: bootstrap → preflight-proof → idempotency-proof.
# No nested cold-start / test-dev-cold-start. Logs via process-substitution (no outer `make … | tee`).
#
# Usage:
#   FULL_STACK_PROOF_CONFIRM=yes make full-stack-proof
#
# Env:
#   FULL_STACK_PROOF_CONFIRM=yes     — required.
#   FULL_STACK_PROOF_REPEAT_PREFLIGHT=yes — second make preflight-lab + artifact guard after first preflight-proof.
# Sets PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT=1 and PREFLIGHT_MIN_BOOTSTRAP_HEALTH=95 for preflight-proof unless overridden.
# Default BOOTSTRAP_FULL_WIPE=1 for a true cold Colima reset (override with BOOTSTRAP_FULL_WIPE=0 to keep the VM).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${FULL_STACK_PROOF_CONFIRM:-}" != "yes" ]]; then
  echo "❌ guard: Set FULL_STACK_PROOF_CONFIRM=yes (runs bootstrap + preflight-lab + idempotency proofs)." >&2
  exit 2
fi

mkdir -p "$REPO_ROOT/bench_logs"
FULL_STACK_LOG="${FULL_STACK_LOG:-$REPO_ROOT/bench_logs/full-stack-proof-$(date -u +%Y%m%d-%H%M%S).log}"
export FULL_STACK_LOG
exec > >(tee -a "$FULL_STACK_LOG") 2>&1

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

artifact_guard() {
  local label="$1"
  local run_dir="$2"
  local f1="$run_dir/telemetry-after.txt"
  local f2="$run_dir/k6-suite-resources.log"
  local f3="$run_dir/suite-logs/suite-timing.txt"
  [[ -f "$f1" ]] || { echo "❌ guard ($label): missing $f1"; exit 3; }
  [[ -f "$f2" ]] || { echo "❌ guard ($label): missing $f2"; exit 3; }
  [[ -f "$f3" ]] || { echo "❌ guard ($label): missing $f3"; exit 3; }
  echo "✅ guard ($label): artifacts present under $run_dir"
}

newest_preflight_run_dir() {
  local best="" t_best=-1 d t
  while IFS= read -r d; do
    [[ -d "$d" ]] || continue
    if [[ "$(uname -s)" == "Darwin" ]]; then t="$(stat -f %m "$d")"; else t="$(stat -c %Y "$d")"; fi
    if (( t > t_best )); then t_best="$t"; best="$d"; fi
  done < <(find "$REPO_ROOT/bench_logs" -maxdepth 1 -type d -name 'run-*' 2>/dev/null)
  [[ -n "$best" ]] || { echo "❌ guard: no bench_logs/run-* directory found"; exit 3; }
  printf '%s' "$best"
}

make() { command make -C "$REPO_ROOT" "$@"; }

echo "=== full-stack-proof (meta) $(stamp) ==="
echo "REPO_ROOT=$REPO_ROOT"
echo "FULL_STACK_LOG=$FULL_STACK_LOG"
echo "FULL_STACK_PROOF_REPEAT_PREFLIGHT=${FULL_STACK_PROOF_REPEAT_PREFLIGHT:-}"

echo "▶ [A] bootstrap (BOOTSTRAP_CONFIRM=yes, BOOTSTRAP_FULL_WIPE=${BOOTSTRAP_FULL_WIPE:-1})…"
export BOOTSTRAP_CONFIRM=yes
export BOOTSTRAP_FULL_WIPE="${BOOTSTRAP_FULL_WIPE:-1}"
make bootstrap

echo "▶ [A2] cluster-doctor (CLUSTER_DOCTOR_STRICT=1)…"
export CLUSTER_DOCTOR_STRICT=1
make cluster-doctor

echo "▶ [B] preflight-proof (bootstrap artifact + health floor)…"
export PREFLIGHT_PROOF_CONFIRM=yes
export PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT="${PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT:-1}"
export PREFLIGHT_MIN_BOOTSTRAP_HEALTH="${PREFLIGHT_MIN_BOOTSTRAP_HEALTH:-95}"
make preflight-proof

if [[ "${FULL_STACK_PROOF_REPEAT_PREFLIGHT:-}" == "yes" ]]; then
  echo "▶ [B2] second make preflight-lab (stability)…"
  make preflight-lab
  run2="$(newest_preflight_run_dir)"
  artifact_guard "preflight-2" "$run2"
  echo "PREFLIGHT_RUN_2=$run2"
fi

echo "▶ [C] idempotency-proof…"
export IDEMPOTENCY_PROOF_CONFIRM=yes
make idempotency-proof

echo "✅ full-stack-proof (meta) complete $(stamp)"
echo "   Log: $FULL_STACK_LOG"
exit 0
