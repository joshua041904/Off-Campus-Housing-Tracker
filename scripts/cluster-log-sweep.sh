#!/usr/bin/env bash
# Cluster log sweep: restart forensics + tail logs + keyword grep for all pods (or selected namespaces).
# Output: bench_logs/forensics/cluster-sweep-<stamp>.log (override with CLUSTER_SWEEP_OUT).
#
# Usage:
#   ./scripts/cluster-log-sweep.sh
#   SWEEP_NAMESPACES="off-campus-housing-tracker ingress-nginx" ./scripts/cluster-log-sweep.sh
#   CLUSTER_SWEEP_TAIL=200 ./scripts/cluster-log-sweep.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" 2>/dev/null || true
_k() { kubectl --request-timeout=25s "$@"; }

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${CLUSTER_SWEEP_DIR:-$REPO_ROOT/bench_logs/forensics}"
mkdir -p "$OUT_DIR"
OUT="${CLUSTER_SWEEP_OUT:-$OUT_DIR/cluster-sweep-$STAMP.log}"
TAIL_N="${CLUSTER_SWEEP_TAIL:-100}"
# Space-separated. Unset SWEEP_NAMESPACES → default three; set SWEEP_NAMESPACES="" for all namespaces; or CLUSTER_SWEEP_ALL_NS=1 forces all.
if [[ "${CLUSTER_SWEEP_ALL_NS:-0}" == "1" ]]; then
  NS_FILTER=""
elif [[ -z "${SWEEP_NAMESPACES+x}" ]]; then
  NS_FILTER="off-campus-housing-tracker ingress-nginx kube-system"
else
  NS_FILTER="${SWEEP_NAMESPACES}"
fi

PATTERN='error|panic|OOM|tls|handshake|disconnected|crash|fatal|OOMKilled|evicted'

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

{
  echo "=== CLUSTER LOG SWEEP ==="
  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "out=$OUT"
  echo ""

  say "=== Restart / lastState summary (jq) ==="
  if ! command -v jq >/dev/null 2>&1; then
    echo "WARN: jq not installed; install jq for structured restart forensics."
  else
    for ns in $(_k get ns -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n' | sort -u); do
      if [[ -n "$NS_FILTER" ]]; then
        _keep=0
        for x in $NS_FILTER; do [[ "$x" == "$ns" ]] && _keep=1; done
        [[ "$_keep" -eq 0 ]] && continue
      fi
      echo "--- NAMESPACE: $ns ---"
      _k get pods -n "$ns" -o json 2>/dev/null | jq -r --arg ns "$ns" '
        .items[]? |
        .metadata.name as $pod |
        .status.containerStatuses[]? |
        select(.restartCount > 0) |
        "\($ns)/\($pod) | container=\(.name) | restarts=\(.restartCount) | lastState=\(.lastState // {})"
      ' 2>/dev/null || echo "(no pods or API error)"
    done
  fi

  say "=== Recent cluster events (tail) ==="
  _k get events -A --sort-by='.lastTimestamp' 2>/dev/null | tail -80 || true

  say "=== Per-pod logs (tail) + keyword hits ==="
  for ns in $(_k get ns -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n' | sort -u); do
    if [[ -n "$NS_FILTER" ]]; then
      _keep=0
      for x in $NS_FILTER; do [[ "$x" == "$ns" ]] && _keep=1; done
      [[ "$_keep" -eq 0 ]] && continue
    fi
    pods=$(_k get pods -n "$ns" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
    for pod in $pods; do
      echo ""
      echo "######## $ns/$pod ########"
      _k get pod -n "$ns" "$pod" -o jsonpath='{.status.containerStatuses[*].name}' 2>/dev/null | tr ' ' '\n' | while read -r ctr; do
        [[ -z "$ctr" ]] && continue
        echo "--- container: $ctr ---"
        if log=$(_k logs -n "$ns" "$pod" -c "$ctr" --tail="$TAIL_N" 2>&1); then
          echo "$log" | grep -Ei "$PATTERN" || echo "(no keyword matches in last $TAIL_N lines)"
        else
          echo "$log"
        fi
      done
    done
  done

  echo ""
  echo "=== SWEEP COMPLETE ==="
} | tee "$OUT"

echo ""
echo "Wrote: $OUT"
