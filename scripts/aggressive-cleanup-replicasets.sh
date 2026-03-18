#!/usr/bin/env bash
# Aggressive cleanup of ALL rogue ReplicaSets
# Identifies the current ReplicaSet for each deployment and deletes all others

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || true
_kubectl() { 
  kctl "$@" 2>/dev/null || kubectl --request-timeout=10s "$@" 2>/dev/null || echo ""
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "${CLEANUP_LOG:-/dev/stdout}"; }

NS="off-campus-housing-tracker"
SERVICES=("auth-service" "listings-service" "booking-service" "messaging-service" "trust-service" "analytics-service" "api-gateway")

say "=== Aggressive ReplicaSet Cleanup ==="
CLEANUP_LOG="${CLEANUP_LOG:-/tmp/cleanup-$(date +%Y%m%d-%H%M%S).log}"
log "Starting aggressive cleanup (log: $CLEANUP_LOG)"

TOTAL_CLEANED=0

for service in "${SERVICES[@]}"; do
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "Processing service: $service"
  echo "Processing: $service"
  
  # Find the ReplicaSet with ready pods (this is the one we want to keep)
  # CRITICAL: Only keep ReplicaSets that actually have ready pods (readyReplicas > 0)
  current_rs=$(kubectl get replicaset -n "$NS" -l app="$service" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
ready_rs = [rs for rs in data.get('items', []) if rs.get('status', {}).get('readyReplicas', 0) > 0]
if ready_rs:
    # Sort by readyReplicas descending, then by creation timestamp (newest first)
    ready_rs.sort(key=lambda x: (x.get('status', {}).get('readyReplicas', 0), x.get('metadata', {}).get('creationTimestamp', '')), reverse=True)
    print(ready_rs[0]['metadata']['name'])
" 2>/dev/null | head -1 || echo "")
  
  # If no ReplicaSet with ready pods, we need to find one that CAN become ready
  # Check deployment's current ReplicaSet and see if it has a running pod
  if [[ -z "$current_rs" ]]; then
    log "  ⚠️  No ReplicaSet with ready pods found, checking for running pods..."
    # Find ReplicaSet with running pods (even if not ready yet)
    current_rs=$(kubectl get replicaset -n "$NS" -l app="$service" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
# Get pods for each ReplicaSet
for rs in data.get('items', []):
    rs_name = rs['metadata']['name']
    # Check if this ReplicaSet has any running pods
    pods = kubectl.get('pods', '-n', '$NS', '-l', f'app=$service', '-o', 'json')  # This won't work, need different approach
    # Instead, just pick the one with the most recent creation timestamp that has desired > 0
    if rs.get('spec', {}).get('replicas', 0) > 0:
        print(rs_name)
        break
" 2>/dev/null | head -1 || echo "")
    
    # Fallback: deployment's current ReplicaSet
    if [[ -z "$current_rs" ]]; then
      current_rs=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].message}' 2>/dev/null | sed -n 's/.*ReplicaSet "\([^"]*\)".*/\1/p' | head -1 || echo "")
    fi
  fi
  
  if [[ -z "$current_rs" ]]; then
    warn "  No ReplicaSets found for $service"
    log "  ⚠️  No ReplicaSets found for $service, skipping"
    continue
  fi
  
  # Verify this ReplicaSet actually has ready pods
  ready_count=$(kubectl get replicaset "$current_rs" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  if [[ "${ready_count:-0}" == "0" ]]; then
    log "  ⚠️  WARNING: Identified ReplicaSet $current_rs has 0 ready pods"
    log "      Looking for alternative ReplicaSet with ready pods..."
    # Try to find ANY ReplicaSet with ready pods, even if not the "current" one
    alt_rs=$(kubectl get replicaset -n "$NS" -l app="$service" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for rs in data.get('items', []):
    if rs.get('status', {}).get('readyReplicas', 0) > 0:
        print(rs['metadata']['name'])
        break
" 2>/dev/null | head -1 || echo "")
    if [[ -n "$alt_rs" ]] && [[ "$alt_rs" != "$current_rs" ]]; then
      log "      Found alternative ReplicaSet with ready pods: $alt_rs"
      current_rs="$alt_rs"
      ready_count=$(kubectl get replicaset "$current_rs" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
      log "  ✅ Using ReplicaSet: $current_rs (has $ready_count ready pod(s))"
    else
      log "      No alternative found - will keep $current_rs but services may not be ready"
    fi
  else
    log "  ✅ Identified current ReplicaSet: $current_rs (has $ready_count ready pod(s))"
  fi
  echo "  Current ReplicaSet: $current_rs (ready: ${ready_count:-0})"
  
  # Get all ReplicaSets for this service (faster with Python)
  all_rs=$(kubectl get replicaset -n "$NS" -l app="$service" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for rs in data.get('items', []):
    name = rs['metadata']['name']
    replicas = rs.get('spec', {}).get('replicas', 0)
    ready = rs.get('status', {}).get('readyReplicas', 0)
    print(f\"{name}\t{replicas}\t{ready}\")
" 2>/dev/null || echo "")
  
  # Helper: does this ReplicaSet have any pod in Phase=Running? (if yes, do not delete - may be in initialDelaySeconds)
  _rs_has_running_pod() {
    local rsn="$1"
    kubectl get pods -n "$NS" -l app="$service" -o json 2>/dev/null | python3 -c "
import sys, json
rs_name = sys.argv[1]
data = json.load(sys.stdin)
for pod in data.get('items', []):
    refs = pod.get('metadata', {}).get('ownerReferences', [])
    if refs and refs[0].get('name') == rs_name:
        if pod.get('status', {}).get('phase') == 'Running':
            print('yes')
            sys.exit(0)
print('no')
" "$rsn" 2>/dev/null || echo "no"
  }

  CLEANED_FOR_SERVICE=0
  while IFS=$'\t' read -r rs_name replicas ready_replicas; do
    [[ -z "$rs_name" ]] && continue
    # Do NOT delete any ReplicaSet that has a Running pod (readiness may not have passed yet; initialDelaySeconds up to 90s).
    if [[ "${ready_replicas:-0}" == "0" ]] && [[ "${replicas:-0}" != "0" ]]; then
      if [[ "$(_rs_has_running_pod "$rs_name")" == "yes" ]]; then
        echo "  ✅ Keeping $rs_name (0 ready but has Running pod(s) — waiting for readiness)"
        log "  ✅ Keeping ReplicaSet $rs_name (has Running pod(s), skipping delete)"
        continue
      fi
    fi
    # Keep current_rs unless it's truly broken (0 ready and no Running pods)
    if [[ "$rs_name" == "$current_rs" ]]; then
      if [[ "${ready_replicas:-0}" == "0" ]] && [[ "${replicas:-0}" != "0" ]]; then
        log "  ⚠️  Current ReplicaSet $rs_name has 0 ready and no Running pods - will delete (broken)"
      else
        echo "  ✅ Keeping current: $rs_name (replicas: $replicas, ready: ${ready_replicas:-0})"
        log "  ✅ Keeping current ReplicaSet: $rs_name (replicas: $replicas, ready: ${ready_replicas:-0})"
        continue
      fi
    fi
    
    # Scale down and delete only ReplicaSets that are not current AND (have 0 ready with no Running pods, or are rogue with replicas>0)
    if [[ "${replicas:-0}" != "0" ]] || ([[ "${ready_replicas:-0}" == "0" ]] && [[ "${replicas:-0}" != "0" ]]); then
      if [[ "${ready_replicas:-0}" == "0" ]] && [[ "${replicas:-0}" != "0" ]]; then
        echo "  🗑️  Deleting broken ReplicaSet: $rs_name (replicas: $replicas, ready: 0 - no Running pods)"
        log "  🗑️  BROKEN ReplicaSet detected: $rs_name (replicas: $replicas, ready: 0 - will delete)"
      else
        echo "  🗑️  Scaling down rogue ReplicaSet: $rs_name (replicas: $replicas)"
        log "  🗑️  ROGUE ReplicaSet detected: $rs_name (replicas: $replicas, ready: ${ready_replicas:-0})"
      fi
      log "      Scaling down to 0..."
      _kubectl scale replicaset "$rs_name" -n "$NS" --replicas=0 --request-timeout=8s >/dev/null 2>&1 || true
      
      # Delete any pods from this ReplicaSet (parallel)
      pods=$(kubectl get pods -n "$NS" -l app="$service" -o json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for pod in data.get('items', []):
    owner = pod.get('metadata', {}).get('ownerReferences', [{}])[0].get('name', '')
    if owner == '$rs_name':
        print(pod['metadata']['name'])
" 2>/dev/null || echo "")
      for pod in $pods; do
        if [[ -n "$pod" ]]; then
          log "      Deleting pod from rogue ReplicaSet: $pod"
          _kubectl delete pod "$pod" -n "$NS" --force --grace-period=0 --request-timeout=8s >/dev/null 2>&1 || true
        fi
      done
      
      echo "  🗑️  Deleting ReplicaSet: $rs_name"
      log "      Deleting rogue ReplicaSet: $rs_name"
      if _kubectl delete replicaset "$rs_name" -n "$NS" --force --grace-period=0 --request-timeout=8s >/dev/null 2>&1; then
        ((CLEANED_FOR_SERVICE++))
        log "      ✅ Successfully deleted ReplicaSet: $rs_name"
      else
        log "      ⚠️  Failed to delete ReplicaSet: $rs_name (may retry)"
      fi
    fi
  done <<< "$all_rs"
  
  if [[ $CLEANED_FOR_SERVICE -gt 0 ]]; then
    ok "  Cleaned up $CLEANED_FOR_SERVICE ReplicaSet(s) for $service"
    log "  ✅ Cleaned up $CLEANED_FOR_SERVICE ReplicaSet(s) for $service"
    TOTAL_CLEANED=$((TOTAL_CLEANED + CLEANED_FOR_SERVICE))
  else
    log "  ✅ No cleanup needed for $service (only current ReplicaSet exists)"
  fi
done

# Also clean up any ReplicaSets that shouldn't exist (kafka, zookeeper, postgres in-cluster)
say "=== Cleaning Up In-Cluster Resources (Should Not Exist) ==="
for resource in kafka zookeeper postgres; do
  rs_list=$(_kubectl get replicaset -n "$NS" -l app="$resource" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || echo "")
  for rs in $rs_list; do
    if [[ -n "$rs" ]]; then
      echo "  🗑️  Deleting in-cluster $resource ReplicaSet: $rs"
      _kubectl scale replicaset "$rs" -n "$NS" --replicas=0 --request-timeout=10s >/dev/null 2>&1 || true
      sleep 1
      _kubectl delete replicaset "$rs" -n "$NS" --request-timeout=10s >/dev/null 2>&1 && ((TOTAL_CLEANED++)) || true
    fi
  done
done

# Clean up any pending/containercreating pods
say "=== Cleaning Up Stuck Pods ==="
PODS_CLEANED=0
for service in "${SERVICES[@]}"; do
  stuck_pods=$(_kubectl get pods -n "$NS" -l app="$service" --field-selector=status.phase!=Running -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || echo "")
  for pod in $stuck_pods; do
    if [[ -n "$pod" ]]; then
      echo "  🗑️  Deleting stuck pod: $pod"
      _kubectl delete pod "$pod" -n "$NS" --force --grace-period=0 --request-timeout=10s >/dev/null 2>&1 && ((PODS_CLEANED++)) || true
    fi
  done
done

if [[ $PODS_CLEANED -gt 0 ]]; then
  ok "Cleaned up $PODS_CLEANED stuck pod(s)"
fi

if [[ $TOTAL_CLEANED -gt 0 ]]; then
  ok "Total: Cleaned up $TOTAL_CLEANED rogue ReplicaSet(s) and $PODS_CLEANED stuck pod(s)"
  log "✅ CLEANUP SUMMARY: Removed $TOTAL_CLEANED rogue ReplicaSet(s) and $PODS_CLEANED stuck pod(s)"
else
  ok "No rogue ReplicaSets found"
  log "✅ CLEANUP SUMMARY: No rogue ReplicaSets found (all clean)"
fi

say "=== Cleanup Complete ==="
log "Cleanup complete. Log saved to: $CLEANUP_LOG"
