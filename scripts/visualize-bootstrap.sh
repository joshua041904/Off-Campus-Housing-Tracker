#!/usr/bin/env bash
# CLI: colored bootstrap DAG vs bench_logs/bootstrap_state_progress.json
# Env: VERIFY_BOOTSTRAP_GRAPH / VERIFY_BOOTSTRAP_PROGRESS / VERIFY_BOOTSTRAP_TIMING_JSON — override paths
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

GRAPH="${VERIFY_BOOTSTRAP_GRAPH:-$ROOT/infra/bootstrap_invariants.graph.json}"
PROGRESS="${VERIFY_BOOTSTRAP_PROGRESS:-$ROOT/bench_logs/bootstrap_state_progress.json}"
TIMING="${VERIFY_BOOTSTRAP_TIMING_JSON:-$ROOT/bench_logs/bootstrap_phase_timings.json}"

command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required" >&2; exit 1; }

ORDER_JSON="$(node "$ROOT/scripts/derive-bootstrap-order.mjs" --graph "$GRAPH")"
mapfile -t ORDER < <(echo "$ORDER_JSON" | jq -r '.allowed_order[]')

_completed_lines="$(jq -r '.completed[]? // empty' "$PROGRESS" 2>/dev/null || true)"
_failed_nodes="$(jq -r '.failed[]? | .node // empty' "$PROGRESS" 2>/dev/null || true)"

is_completed() {
  local p="$1"
  grep -Fxq "$p" <<< "$_completed_lines" 2>/dev/null || return 1
}

is_failed() {
  local p="$1"
  grep -Fxq "$p" <<< "$_failed_nodes" 2>/dev/null || return 1
}

phase_timing_suffix() {
  local phase="$1"
  if [[ ! -f "$TIMING" ]]; then
    return
  fi
  local ms
  ms="$(jq -r --arg p "$phase" '.[$p] // empty' "$TIMING" 2>/dev/null || true)"
  if [[ -n "$ms" && "$ms" != "null" ]]; then
    printf ' (%sms)' "$ms"
  fi
}

phase_fail_log() {
  local phase="$1"
  jq -r --arg n "$phase" '.failed[]? | select(.node==$n) | .logFile // empty' "$PROGRESS" 2>/dev/null | head -1
}

c_done=$'\033[32m'
c_fail=$'\033[31m'
c_pend=$'\033[90m'
c_rst=$'\033[0m'

echo "=== Bootstrap DAG status ==="
echo "graph: $GRAPH"
echo "progress: $PROGRESS"
echo "timings: $TIMING"
echo ""

for phase in "${ORDER[@]}"; do
  suf="$(phase_timing_suffix "$phase")"
  if is_failed "$phase"; then
    msg="$(jq -r --arg n "$phase" '.failed[]? | select(.node==$n) | .message' "$PROGRESS" 2>/dev/null | head -1)"
    logf="$(phase_fail_log "$phase")"
    extra=""
    [[ -n "$logf" ]] && extra="  📄 ${logf}"
    echo "${c_fail}🔴 ${phase}${suf}${c_rst}  ${msg:-failed}${extra}"
  elif is_completed "$phase"; then
    echo "${c_done}🟢 ${phase}${suf}${c_rst}"
  else
    echo "${c_pend}⚪ ${phase}${suf}${c_rst}"
  fi
done
