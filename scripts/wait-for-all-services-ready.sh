#!/usr/bin/env bash
# Wait for all services to be ready before proceeding with test suite
# Ensures all 9 services are 1/1 Ready before continuing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

# Load kubectl helper if available
[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || true

# _kubectl wrapper: use direct kubectl with timeout for reliability
_kubectl() { 
  kubectl --request-timeout=15s "$@" 2>/dev/null || echo ""
}

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }
log() { 
  local msg="[$(date +%H:%M:%S)] $*"
  echo "$msg" >> "${WAIT_LOG:-/dev/stdout}" 2>/dev/null || echo "$msg"
}

NS="off-campus-housing-tracker"
SERVICES=("auth-service" "listings-service" "booking-service" "messaging-service" "trust-service" "analytics-service" "api-gateway")
EXPECTED_COUNT=${#SERVICES[@]}

# Optional: also wait for Caddy (ingress-nginx) and Envoy (envoy-test) so cluster is fully ready for suites
WAIT_CADDY_ENVOY="${WAIT_CADDY_ENVOY:-1}"  # 1 = require caddy-h3 2/2 and envoy 1/1

# Allow environment variables to override defaults
MAX_WAIT="${MAX_WAIT:-600}"  # Default 10 minutes
CHECK_INTERVAL="${CHECK_INTERVAL:-10}"  # Check every 10 seconds
PROGRESS_INTERVAL="${PROGRESS_INTERVAL:-30}"  # Show progress every 30 seconds
INITIAL_WAIT="${INITIAL_WAIT:-30}"  # Wait 30s initially for pods to start after restarts
SELF_HEAL_THRESHOLD="${SELF_HEAL_THRESHOLD:-120}"  # Try self-healing after 2 minutes

# Debug: log configuration
log "CONFIG: MAX_WAIT=${MAX_WAIT}, CHECK_INTERVAL=${CHECK_INTERVAL}, INITIAL_WAIT=${INITIAL_WAIT}"
WAIT_LOG="${WAIT_LOG:-/tmp/wait-services-$(date +%Y%m%d-%H%M%S).log}"

say "Waiting for all $EXPECTED_COUNT services to be ready (max ${MAX_WAIT}s)..."
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "WAIT START: Waiting for $EXPECTED_COUNT services (max ${MAX_WAIT}s, log: $WAIT_LOG)"
log "Services: ${SERVICES[*]}"

# Initial wait for pods to start after restarts
if [[ $INITIAL_WAIT -gt 0 ]]; then
  echo "  Initial wait: ${INITIAL_WAIT}s for pods to start after restarts..."
  log "INITIAL_WAIT: Waiting ${INITIAL_WAIT}s for pods to start after restarts..."
  sleep $INITIAL_WAIT
  log "INITIAL_WAIT: Complete, starting readiness checks..."
fi

ELAPSED=$INITIAL_WAIT
LAST_PROGRESS=$INITIAL_WAIT
FIRST_CHECK_DONE=0

# Debug: log that we're entering the loop
log "DEBUG: Entering readiness check loop (ELAPSED=${ELAPSED}, MAX_WAIT=${MAX_WAIT})"

while [[ $ELAPSED -lt $MAX_WAIT ]]; do
  READY_COUNT=0
  NOT_READY=()
  
  # Debug: log start of service check
  log "DEBUG: Checking services (iteration, ELAPSED=${ELAPSED})"
  
  # Always check all services (with timeout protection)
  for service in "${SERVICES[@]}"; do
    # Use timeout to prevent hanging - direct kubectl call
    ready=$(kubectl --request-timeout=5s get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    desired=$(kubectl --request-timeout=5s get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    
    # Handle <none> or empty values
    [[ -z "$ready" ]] && ready="0"
    [[ "$ready" == "<none>" ]] && ready="0"
    [[ -z "$desired" ]] && desired="0"
    [[ "$desired" == "<none>" ]] && desired="0"
    
    if [[ "$desired" == "1" ]] && [[ "$ready" == "1" ]]; then
      ((READY_COUNT++)) || true  # Prevent exit on arithmetic error
    else
      NOT_READY+=("$service:$ready/$desired")
    fi
  done
  
  # Debug: log after checking all services
  log "DEBUG: Checked all services - READY_COUNT=$READY_COUNT/$EXPECTED_COUNT"
  
  # Check immediately on first iteration after INITIAL_WAIT
  if [[ $FIRST_CHECK_DONE -eq 0 ]]; then
    FIRST_CHECK_DONE=1
    echo "  Initial check: $READY_COUNT/$EXPECTED_COUNT ready"
    log "CHECK: Initial status after ${INITIAL_WAIT}s wait - $READY_COUNT/$EXPECTED_COUNT ready"
    if [[ ${#NOT_READY[@]} -gt 0 ]]; then
      echo "  Not ready: ${NOT_READY[*]}"
      log "  Not ready services: ${NOT_READY[*]}"
    else
      echo "  ✅ All services ready!"
      log "  ✅ All services ready!"
    fi
  fi
  
  # Optional: Caddy (ingress-nginx) and Envoy (envoy-test)
  CADDY_ENVOY_OK=1
  if [[ "$WAIT_CADDY_ENVOY" == "1" ]]; then
    caddy_ready=$(kubectl --request-timeout=5s get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    caddy_desired=$(kubectl --request-timeout=5s get deployment caddy-h3 -n ingress-nginx -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    envoy_ready=$(kubectl --request-timeout=5s get deployment envoy-test -n envoy-test -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    envoy_desired=$(kubectl --request-timeout=5s get deployment envoy-test -n envoy-test -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
    [[ -z "$caddy_ready" ]] && caddy_ready="0"
    [[ -z "$envoy_ready" ]] && envoy_ready="0"
    if [[ "$caddy_ready" != "$caddy_desired" ]] || [[ "$envoy_ready" != "$envoy_desired" ]]; then
      CADDY_ENVOY_OK=0
    fi
  fi

  # If all ready (off-campus-housing-tracker + optional caddy/envoy), exit immediately (check BEFORE sleep)
  if [[ $READY_COUNT -eq $EXPECTED_COUNT ]] && [[ "$CADDY_ENVOY_OK" == "1" ]]; then
    ok "All $EXPECTED_COUNT services are ready!"
    [[ "$WAIT_CADDY_ENVOY" == "1" ]] && ok "Caddy (2/2) and Envoy (1/1) ready"
    log "✅ SUCCESS: All $EXPECTED_COUNT services + Caddy + Envoy ready (elapsed: ${ELAPSED}s)"
    exit 0
  fi
  
  # Debug: log every check (after exit check to avoid unnecessary logging)
  if [[ $((ELAPSED % CHECK_INTERVAL)) -eq 0 ]] || [[ $FIRST_CHECK_DONE -eq 1 ]]; then
    log "CHECK: $READY_COUNT/$EXPECTED_COUNT ready (elapsed: ${ELAPSED}s, not ready: ${NOT_READY[*]})"
  fi
  
  # Debug: log current status every check
  log "CHECK: $READY_COUNT/$EXPECTED_COUNT ready (elapsed: ${ELAPSED}s, not ready: ${NOT_READY[*]})"
  
  # Show progress periodically (every PROGRESS_INTERVAL seconds)
  if [[ $((ELAPSED - LAST_PROGRESS)) -ge $PROGRESS_INTERVAL ]]; then
    say "Progress: $READY_COUNT/$EXPECTED_COUNT ready (${ELAPSED}s elapsed)"
    log "CHECK: Progress - $READY_COUNT/$EXPECTED_COUNT ready (${ELAPSED}s elapsed)"
    if [[ ${#NOT_READY[@]} -gt 0 ]]; then
      echo "  Not ready: ${NOT_READY[*]}"
      log "  Not ready services: ${NOT_READY[*]}"
    fi
    if [[ "$WAIT_CADDY_ENVOY" == "1" ]] && [[ "$CADDY_ENVOY_OK" != "1" ]]; then
      echo "  Caddy (ingress-nginx): $caddy_ready/$caddy_desired, Envoy (envoy-test): $envoy_ready/$envoy_desired"
      log "  Caddy $caddy_ready/$caddy_desired, Envoy $envoy_ready/$envoy_desired"
    fi
    if [[ ${#NOT_READY[@]} -gt 0 ]]; then
      # Log detailed status for each not-ready service
      for not_ready in "${NOT_READY[@]}"; do
        svc="${not_ready%%:*}"
        log "    $svc: Checking pod status..."
        pod=$(_kubectl get pods -n "$NS" -l app="$svc" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
        if [[ -n "$pod" ]]; then
          phase=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
          ready_status=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
          waiting_reason=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || echo "")
          log "      Pod $pod: phase=$phase, ready=$ready_status, waiting=$waiting_reason"
        fi
      done
    fi
    LAST_PROGRESS=$ELAPSED
  fi
  
  # Self-healing: If stuck for too long, try to fix
  if [[ $ELAPSED -ge $SELF_HEAL_THRESHOLD ]] && [[ $READY_COUNT -lt $EXPECTED_COUNT ]] && [[ $((ELAPSED % SELF_HEAL_THRESHOLD)) -eq 0 ]]; then
    log "🔧 SELF-HEAL: Stuck at $READY_COUNT/$EXPECTED_COUNT for ${ELAPSED}s, attempting self-healing..."
    echo "  🔧 Attempting self-healing..."
    
    # Try aggressive cleanup again
    if [[ -f "$SCRIPT_DIR/aggressive-cleanup-replicasets.sh" ]]; then
      log "  Running aggressive cleanup..."
      CLEANUP_LOG="$WAIT_LOG" "$SCRIPT_DIR/aggressive-cleanup-replicasets.sh" >> "$WAIT_LOG" 2>&1 || true
    fi
    
    # For each not-ready service, check and potentially restart
    for not_ready in "${NOT_READY[@]}"; do
      svc="${not_ready%%:*}"
      log "  Checking $svc..."
      pod=$(_kubectl get pods -n "$NS" -l app="$svc" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
      if [[ -n "$pod" ]]; then
        phase=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
        log "    Pod $pod: phase=$phase"
        if [[ "$phase" == "Pending" ]] || [[ "$phase" == "ContainerCreating" ]]; then
          log "    ⚠️  Pod stuck in $phase, deleting to force recreation..."
          _kubectl delete pod "$pod" -n "$NS" --force --grace-period=0 --request-timeout=10s >/dev/null 2>&1 || true
        fi
      fi
    done
    
    log "  Self-healing complete, continuing to wait..."
    sleep 5
  fi
  
  # If all ready (off-campus-housing-tracker + optional caddy/envoy), exit (double-check before sleep)
  if [[ $READY_COUNT -eq $EXPECTED_COUNT ]] && [[ "$CADDY_ENVOY_OK" == "1" ]]; then
    ok "All $EXPECTED_COUNT services are ready!"
    [[ "$WAIT_CADDY_ENVOY" == "1" ]] && ok "Caddy (2/2) and Envoy (1/1) ready"
    log "✅ SUCCESS: All $EXPECTED_COUNT services + Caddy + Envoy ready (elapsed: ${ELAPSED}s)"
    exit 0
  fi
  
  # Log every check for detailed debugging (but not too verbose)
  if [[ $((ELAPSED % CHECK_INTERVAL)) -eq 0 ]] && [[ $ELAPSED -gt $INITIAL_WAIT ]] && [[ $READY_COUNT -lt $EXPECTED_COUNT ]]; then
    log "CHECK: $READY_COUNT/$EXPECTED_COUNT ready (${ELAPSED}s elapsed, not ready: ${NOT_READY[*]})"
  fi
  
  # Sleep before next check
  sleep $CHECK_INTERVAL
  ELAPSED=$((ELAPSED + CHECK_INTERVAL))
done

# Timeout reached
warn "Only $READY_COUNT/$EXPECTED_COUNT services ready after ${MAX_WAIT}s"
log "❌ TIMEOUT: Only $READY_COUNT/$EXPECTED_COUNT services ready after ${MAX_WAIT}s"
say "Not ready services:"
log "Not ready services:"
for service in "${SERVICES[@]}"; do
  ready=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  if [[ "$ready" != "$desired" ]] || [[ "$ready" != "1" ]]; then
    echo "  ⚠️  $service: $ready/$desired"
    log "  ⚠️  $service: $ready/$desired"
    # Show pod status
    pod=$(_kubectl get pods -n "$NS" -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$pod" ]]; then
      phase=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
      ready_status=$(_kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
      echo "    Pod: $pod ($phase, ready: $ready_status)"
      log "    Pod: $pod ($phase, ready: $ready_status)"
      
      # Get last few events
      log "    Recent events:"
      _kubectl get events -n "$NS" --field-selector involvedObject.name="$pod" --sort-by='.lastTimestamp' --request-timeout=10s 2>/dev/null | tail -3 | while read line; do
        [[ -n "$line" ]] && log "      $line"
      done || log "      (no events)"
    fi
  fi
done

log "❌ FAILED: Not all services are ready. Check log: $WAIT_LOG"
fail "Not all services are ready. Fix issues and re-run. Check log: $WAIT_LOG"
exit 1
