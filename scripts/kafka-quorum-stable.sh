#!/usr/bin/env bash
# Gate: no KRaft controller "leader is (none)" lines in kafka-0 logs in the last STABLE_WINDOW_SEC.
# Absorbs transient election churn before app rollouts / edge checks.
#
# Env:
#   HOUSING_NS — default off-campus-housing-tracker
#   KAFKA_QUORUM_STABLE_WINDOW_SEC — default 30
#   KAFKA_QUORUM_STABLE_MAX_WAIT_SEC — default 600 (fail if still churning)
#   KAFKA_QUORUM_STABLE_POLL_SEC — default 5
#   KAFKA_QUORUM_STABLE_SKIP=1 — no-op success
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
WIN="${KAFKA_QUORUM_STABLE_WINDOW_SEC:-30}"
MAX_WAIT="${KAFKA_QUORUM_STABLE_MAX_WAIT_SEC:-600}"
POLL="${KAFKA_QUORUM_STABLE_POLL_SEC:-5}"
POD="${KAFKA_QUORUM_STABLE_POD:-kafka-0}"
CONTAINER="${KAFKA_QUORUM_STABLE_CONTAINER:-kafka}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }

if [[ "${KAFKA_QUORUM_STABLE_SKIP:-0}" == "1" ]]; then
  say "=== kafka-quorum-stable (skipped KAFKA_QUORUM_STABLE_SKIP=1) ==="
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required"; exit 1; }

say "=== kafka-quorum-stable (ns=$NS pod=$POD window=${WIN}s max_wait=${MAX_WAIT}s) ==="

if ! kubectl get "pod/$POD" -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
  echo "❌ Pod $POD not found in $NS"
  exit 1
fi

_started="$(date +%s)"
while true; do
  # QuorumController "leader is (none)" — election in progress; not GroupCoordinator epochs.
  _recent="$(
    kubectl logs "$POD" -n "$NS" -c "$CONTAINER" --request-timeout=45s --since="${WIN}s" 2>/dev/null \
      | grep -F 'QuorumController' | grep -F 'leader is (none)' || true
  )"
  if [[ -z "$_recent" ]]; then
    ok "No QuorumController 'leader is (none)' in last ${WIN}s — stable"
    exit 0
  fi
  _now="$(date +%s)"
  _elapsed=$((_now - _started))
  if [[ "$_elapsed" -ge "$MAX_WAIT" ]]; then
    echo "❌ Controller churn still present after ${MAX_WAIT}s (last ${WIN}s window). Sample:" >&2
    echo "$_recent" | tail -n 15 >&2
    echo "   Hint: kubectl logs $POD -n $NS -c $CONTAINER --tail=200 | grep -E 'QuorumController|RaftManager|disconnected'" >&2
    exit 1
  fi
  echo "⏳ QuorumController 'leader is (none)' in last ${WIN}s — waiting ${POLL}s (${_elapsed}s / ${MAX_WAIT}s)…"
  sleep "$POLL"
done
