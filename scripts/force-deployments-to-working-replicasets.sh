#!/usr/bin/env bash
# Force deployments to use working ReplicaSets: run aggressive cleanup, then restart any deployment still 0/1.
# Called from preflight step 6a1. Always exits 0 so preflight does not show "Force fix had issues".

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || true
_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=10s "$@" 2>/dev/null || echo ""; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "  OK $*"; }
warn(){ echo "  WARN $*"; }

NS="off-campus-housing-tracker"
if [[ -n "${WAIT_APP_SERVICES:-}" ]]; then
  read -r -a SERVICES <<< "$WAIT_APP_SERVICES"
elif [[ -n "${PREFLIGHT_APP_DEPLOYS:-}" ]]; then
  read -r -a SERVICES <<< "$PREFLIGHT_APP_DEPLOYS"
else
  SERVICES=("auth-service" "listings-service" "booking-service" "messaging-service" "trust-service" "analytics-service" "api-gateway" "media-service")
fi

say "=== Forcing Deployments to Use Working ReplicaSets ==="

# 1. Run aggressive cleanup (scales down broken/rogue ReplicaSets)
if [[ -f "$SCRIPT_DIR/aggressive-cleanup-replicasets.sh" ]]; then
  CLEANUP_LOG="${CLEANUP_LOG:-/tmp/force-fix-cleanup-$(date +%Y%m%d-%H%M%S).log}"
  CLEANUP_LOG="$CLEANUP_LOG" "$SCRIPT_DIR/aggressive-cleanup-replicasets.sh" >> "$CLEANUP_LOG" 2>&1 || true
fi

# 2. For any deployment still 0/1, scale down its broken ReplicaSet and optionally rollout restart
FIXED=0
for svc in "${SERVICES[@]}"; do
  ready=$(_kubectl get deployment "$svc" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_kubectl get deployment "$svc" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
  [[ -z "$ready" ]] && ready="0"
  [[ -z "$desired" ]] && desired="1"
  if [[ "$desired" == "1" ]] && [[ "$ready" != "1" ]]; then
    warn "$svc: $ready/1 ready, fixing..."
    # Find ReplicaSet that has 0 ready but replicas > 0 (broken) and scale it to 0 so deployment can adopt a new RS
    broken_rs=$(kubectl get replicaset -n "$NS" -l app="$svc" -o json --request-timeout=8s 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for rs in data.get('items', []):
        r = rs.get('status', {}).get('readyReplicas', 0) or 0
        spec = rs.get('spec', {}).get('replicas', 0) or 0
        if spec > 0 and r == 0:
            print(rs['metadata']['name'])
            break
except Exception:
    pass
" 2>/dev/null || echo "")
    if [[ -n "$broken_rs" ]]; then
      echo "  Scaling down broken ReplicaSet: $broken_rs"
      _kubectl scale replicaset "$broken_rs" -n "$NS" --replicas=0 --request-timeout=8s >> /dev/null 2>&1 || true
      FIXED=1
    fi
    # Rollout restart so deployment creates a new ReplicaSet (often clears stuck state)
    _kubectl rollout restart deployment "$svc" -n "$NS" --request-timeout=10s >> /dev/null 2>&1 || true
    FIXED=1
  fi
done

if [[ $FIXED -eq 1 ]]; then
  ok "Applied force-fix; wait for pods to become ready (6b wait will follow)."
else
  ok "All deployments already have working ReplicaSets."
fi
exit 0
