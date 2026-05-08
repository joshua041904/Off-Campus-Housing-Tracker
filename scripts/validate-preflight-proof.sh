#!/usr/bin/env bash
# Preflight proof: preflight-lab + minimal artifact guard (expects cluster already up).
# Run: PREFLIGHT_PROOF_CONFIRM=yes make preflight-proof
# Optional: PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT=1 — require bench_logs/bootstrap-artifact.json (BOOTSTRAP_COMPLETE)
#   and bench_logs/bootstrap-health.json with score ≥ PREFLIGHT_MIN_BOOTSTRAP_HEALTH (default 95).
# Logging: internal tee (no outer `make … | tee`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${PREFLIGHT_PROOF_CONFIRM:-}" != "yes" ]]; then
  echo "❌ guard: Set PREFLIGHT_PROOF_CONFIRM=yes (long preflight-lab run)." >&2
  exit 2
fi

if [[ "${PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT:-0}" == "1" ]]; then
  _b="$REPO_ROOT/bench_logs/bootstrap-artifact.json"
  if [[ ! -f "$_b" ]]; then
    echo "❌ PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT=1 but missing $_b — run: BOOTSTRAP_CONFIRM=yes make bootstrap" >&2
    exit 4
  fi
  if ! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("state")=="BOOTSTRAP_COMPLETE" else 1)' "$_b"; then
    echo "❌ $_b must have state BOOTSTRAP_COMPLETE (re-run bootstrap)" >&2
    exit 4
  fi
  _h="$REPO_ROOT/bench_logs/bootstrap-health.json"
  if [[ ! -f "$_h" ]]; then
    echo "❌ PREFLIGHT_REQUIRE_BOOTSTRAP_ARTIFACT=1 but missing $_h — bootstrap must write bootstrap-health.json" >&2
    exit 4
  fi
  _min="${PREFLIGHT_MIN_BOOTSTRAP_HEALTH:-95}"
  if ! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); s=int(d.get("score",0)); m=int(sys.argv[2]); sys.exit(0 if s>=m else 1)' "$_h" "$_min"; then
    echo "❌ $_h score must be >= ${_min} (got below floor; re-run bootstrap or raise cluster health). Set PREFLIGHT_MIN_BOOTSTRAP_HEALTH to override." >&2
    exit 4
  fi
fi

mkdir -p "$REPO_ROOT/bench_logs"
PREFLIGHT_PROOF_LOG="${PREFLIGHT_PROOF_LOG:-$REPO_ROOT/bench_logs/preflight-proof-$(date -u +%Y%m%d-%H%M%S).log}"
export PREFLIGHT_PROOF_LOG
exec > >(tee -a "$PREFLIGHT_PROOF_LOG") 2>&1

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
make() { command make -C "$REPO_ROOT" "$@"; }

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

echo "=== preflight-proof $(stamp) ==="
echo "REPO_ROOT=$REPO_ROOT"
echo "PREFLIGHT_PROOF_LOG=$PREFLIGHT_PROOF_LOG"

echo "▶ make preflight-lab…"
make preflight-lab

run1="$(newest_preflight_run_dir)"
artifact_guard "preflight-1" "$run1"
echo "PREFLIGHT_RUN_1=$run1"

echo "✅ preflight-proof complete $(stamp)"
echo "   Log: $PREFLIGHT_PROOF_LOG"
exit 0
