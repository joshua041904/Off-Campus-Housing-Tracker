#!/usr/bin/env bash
# Find idle/stale processes (pipeline, preflight, suites, tcpdump, k6), kill them, then optionally run full pipeline.
#
# What we kill (no interference with current run):
#   - run-full-pipeline, run-preflight-scale-and-all-suites, run-preflight-and-test-suite, run-full-flow-k3d
#   - run-all-test-suites, test-microservices-http2-http3, test-auth-service, enhanced-adversarial-tests
#   - rotation-suite, test-packet-capture-standalone, verify-metallb-and-traffic-policy
#   - k6 run, k6-chaos
#   - kubectl wait condition=ready, kubectl exec tcpdump, tcpdump -i any
#   - ensure-api-server-ready (long-running wait)
# Use: ./scripts/find-and-kill-idle-then-run-pipeline.sh
#   KILL=0          only list matching PIDs, do not kill
#   KILL_ONLY=1     kill then exit (don't run pipeline). Used by run-all-test-suites and run-preflight-scale-and-all-suites.
#   CALLER_PID=$$   pass so we never kill the process that invoked us (e.g. preflight or run-all).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

KILL="${KILL:-1}"
LOG="${REPO_ROOT}/idle-kill-and-pipeline.log"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

log() { echo "$*" >> "$LOG"; }

touch "$LOG"
log "=== $(date +%Y-%m-%dT%H:%M:%S) find-and-kill-idle-then-run-pipeline ==="

# 1. Patterns for pipeline/test processes we may want to kill (avoids interference: preflight, suites, capture, k6)
PATTERNS=(
  "run-full-pipeline"
  "run-preflight-scale-and-all-suites"
  "run-preflight-and-test-suite"
  "run-full-flow-k3d"
  "run-all-test-suites"
  "test-microservices-http2-http3"
  "test-auth-service.sh"
  "enhanced-adversarial-tests"
  "rotation-suite"
  "test-packet-capture-standalone"
  "verify-metallb-and-traffic-policy"
  "k6 run"
  "k6-chaos"
  "nohup.*run-full-pipeline"
  "kubectl.*wait.*condition=ready"
  "kubectl.*exec.*tcpdump"
  "kubectl exec.*tcpdump"
  "tcpdump -i any"
  "ensure-api-server-ready"
)

# 2. Collect PIDs (avoid our own PID, caller, ancestors, and caller's descendants — never kill the process that invoked us or its children e.g. telemetry loop)
ANCESTORS=()
p=$$
while [[ -n "$p" ]] && [[ "$p" != "1" ]]; do
  ANCESTORS+=("$p")
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' \t') || break
done
# Caller may pass CALLER_PID=$$ so we never kill the preflight/pipeline that invoked us (e.g. when run from a pipe)
[[ -n "${CALLER_PID:-}" ]] && ANCESTORS+=("$CALLER_PID")

# Never kill caller's children (e.g. preflight's telemetry loop, ensure-api-server-ready subprocess)
_descendants_of() {
  local root=$1
  local child
  for child in $(pgrep -P "$root" 2>/dev/null || true); do
    [[ -z "$child" ]] && continue
    echo "$child"
    _descendants_of "$child" 2>/dev/null || true
  done
}
DESCENDANTS=()
if [[ -n "${CALLER_PID:-}" ]]; then
  while IFS= read -r pid; do [[ -n "$pid" ]] && DESCENDANTS+=("$pid"); done < <(_descendants_of "$CALLER_PID" 2>/dev/null || true)
fi

# Never kill Colima/Lima stack (colima, limactl) — pgrep -f "kubectl.*exec.*tcpdump" can match "colima ssh -- kubectl exec ..."
EXCLUDE_COMM=("colima" "limactl")
TO_KILL=()
for pat in "${PATTERNS[@]}"; do
  pids=$(pgrep -f "$pat" 2>/dev/null || true)
  for pid in $pids; do
    [[ -z "$pid" ]] && continue
    skip=0
    for a in "${ANCESTORS[@]}"; do [[ "$pid" == "$a" ]] && skip=1 && break; done
    [[ $skip -eq 1 ]] && continue
    for d in "${DESCENDANTS[@]}"; do [[ "$pid" == "$d" ]] && skip=1 && break; done
    [[ $skip -eq 1 ]] && continue
    _comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' \t' || true)
    for ex in "${EXCLUDE_COMM[@]}"; do [[ "$_comm" == *"$ex"* ]] && skip=1 && break; done
    [[ $skip -eq 1 ]] && continue
    TO_KILL+=("$pid")
  done
done

# 3. Deduplicate
UNIQ=()
for p in "${TO_KILL[@]}"; do
  if [[ " ${UNIQ[*]} " != *" $p "* ]]; then
    UNIQ+=("$p")
  fi
done

if [[ ${#UNIQ[@]} -eq 0 ]]; then
  ok "No idle pipeline/test processes found."
  log "No PIDs to kill"
else
  say "Found ${#UNIQ[@]} possibly idle process(es):"
  log "Found ${#UNIQ[@]} PIDs: ${UNIQ[*]}"
  for p in "${UNIQ[@]}"; do
    line=$(ps -p "$p" -o pid=,comm=,etime= 2>/dev/null || echo "$p ? ?")
    echo "  $line"
    log "  $line"
  done
  if [[ "$KILL" == "1" ]]; then
    say "Killing them..."
    for p in "${UNIQ[@]}"; do
      if kill -9 "$p" 2>/dev/null; then
        ok "Killed $p"
        log "Killed $p"
      else
        warn "Could not kill $p"
        log "Could not kill $p"
      fi
    done
  else
    warn "KILL=0: not killing. Run with KILL=1 to kill."
    log "KILL=0 skip"
  fi
fi

# 4. Brief pause
sleep 2

# KILL_ONLY=1: just kill stale processes, then exit (don't run pipeline)
if [[ "${KILL_ONLY:-0}" == "1" ]]; then
  ok "Kill-only done. Run pipeline separately."
  exit 0
fi

# 5. Run full pipeline (append to same log via run-full-pipeline's own logging)
say "Running full pipeline..."
log "Starting run-full-pipeline"
"$SCRIPT_DIR/run-full-pipeline.sh"
rc=$?
log "=== Pipeline exit $rc $(date +%Y-%m-%dT%H:%M:%S) ==="
echo "=== Pipeline exit $rc $(date +%Y-%m-%dT%H:%M:%S) ==="
exit $rc
