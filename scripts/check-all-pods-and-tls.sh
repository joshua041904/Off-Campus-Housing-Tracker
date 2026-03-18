#!/usr/bin/env bash
# Check all pods health and strict TLS configuration.
# Supports Colima/k3s; uses kubectl shim (shims-first PATH).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Shims first so kubectl uses shim (avoids API server timeouts)
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kubectl() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || colima ssh -- kubectl --request-timeout=10s "$@"
  else
    kctl "$@" 2>/dev/null || kubectl --request-timeout=10s "$@"
  fi
}
# Run kubectl with cap seconds; avoid hanging on a single call.
# Prefer _kubectl (--request-timeout) for deploy/secret checks; use _kubectl_cap only when necessary.
_kubectl_cap() {
  local cap="${1:-12}" tmp out
  tmp=$(mktemp 2>/dev/null) || tmp="/tmp/kctl-$$"
  shift
  ( _kubectl "$@" > "$tmp" 2>/dev/null ) &
  local pid=$!
  ( sleep "$cap"; kill -9 $pid 2>/dev/null ) &
  local kpid=$!
  wait $pid 2>/dev/null || true
  kill $kpid 2>/dev/null || true
  wait $kpid 2>/dev/null || true
  out=$(cat "$tmp" 2>/dev/null)
  rm -f "$tmp"
  echo "$out"
}

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; }

say "=== Complete Pod Health and TLS Check ==="
# Do not exit on first failed command so we always print all sections; preflight continues either way.
set +e

# 1. Preflight kubeconfig (skip if SKIP_PREFLIGHT=1, e.g. when run from run-preflight-scale)
if [[ "${SKIP_PREFLIGHT:-0}" != "1" ]]; then
  say "1. Preflight kubeconfig..."
  [[ -f "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" ]] && PREFLIGHT_CAP="${PREFLIGHT_CAP:-45}" "$SCRIPT_DIR/preflight-fix-kubeconfig.sh" 2>/dev/null || warn "Preflight had issues; continuing."
else
  say "1. Preflight (skipped, SKIP_PREFLIGHT=1)"
fi

# 2. Check external database ports (8 PostgreSQL: docker-compose 5433–5440). Port UP = reachable; database names (listings, shopping, auth, etc.) must exist on each instance.
say "2. Checking external database ports (8 PostgreSQL)..."
DB_PORTS=(5433 5434 5435 5436 5437 5438 5439 5440)
DB_UP=0
for port in "${DB_PORTS[@]}"; do
  if nc -z localhost "$port" 2>/dev/null; then
    ((DB_UP++)) || true
    ok "Port $port: UP"
  else
    warn "Port $port: DOWN"
  fi
done
if [[ "${DB_UP:-0}" -eq 8 ]]; then
  ok "All 8 database ports UP (reachable)"
  info "Database names (listings, shopping, auth, etc.) must exist on each port — create with infra/db/00-create-*-database.sql or run preflight without SKIP_PREFLIGHT_MIGRATIONS=1 for 9/9"
else
  warn "Only ${DB_UP:-0}/8 database ports UP (expected 5433–5440)"
fi

# 3. Kafka: external strict TLS (Docker Compose :29093). No in-cluster Kafka/ZK.
say "3. Checking Kafka (external strict TLS, :29093)..."
# Check from host (not inside cluster) - Kafka is on host.docker.internal from cluster perspective
if nc -z 127.0.0.1 29093 2>/dev/null || nc -z localhost 29093 2>/dev/null; then
  ok "Kafka (external 29093): UP"
else
  # Try checking if Docker container is running
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "kafka"; then
    warn "Kafka container running but port 29093 not accessible from host — may need to wait for startup"
  else
    warn "Kafka (external 29093): DOWN — run: docker compose up -d kafka zookeeper"
  fi
fi

# 4. Redis external (port 6379) + Lua scripting (cache hits)
say "4. Checking Redis (external) and Lua scripting..."
if nc -z localhost 6379 2>/dev/null; then
  ok "Redis (6379): UP"
  if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli -h localhost -p 6379 ping 2>/dev/null | grep -q PONG; then
      ok "Redis PING: OK"
      if redis-cli -h localhost -p 6379 EVAL "return 1" 0 2>/dev/null | grep -q "1"; then
        ok "Redis Lua scripting: OK (cache-hit checks supported)"
      else
        warn "Redis Lua EVAL failed (cache-hit checks may be limited)"
      fi
    else
      warn "Redis PING failed"
    fi
  else
    warn "redis-cli not installed; skipping Lua check"
  fi
else
  warn "Redis (6379): DOWN (external Redis required for cache hits)"
fi

# 5. Service pods (record-platform, 1/1 each) — use _kubectl (request-timeout); avoid cap timeouts
say "5. Checking service pods (record-platform, should be 1/1 Ready)..."
SERVICES=("auth-service" "records-service" "listings-service" "social-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")
READY=0
TOTAL=0
NOT_READY=()

# First pass: check status
for svc in "${SERVICES[@]}"; do
  TOTAL=$((TOTAL + 1))
  R=$(_kubectl get deploy -n record-platform "$svc" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  S=$(_kubectl get deploy -n record-platform "$svc" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
  [[ -z "$R" ]] && R="0"
  [[ -z "$S" ]] && S="1"
  if [[ "$R" == "1" && "$S" == "1" ]]; then
    ((READY++)) || true
    ok "$svc: 1/1"
  else
    warn "$svc: $R/$S"
    NOT_READY+=("$svc")
  fi
done

# If not all ready, diagnose and fix
if [[ "${READY:-0}" -ne 9 ]]; then
  warn "Only ${READY:-0}/9 services Ready - diagnosing issues..."
  echo "  If pod logs show \"database X does not exist\", create that database on the correct port (e.g. infra/db/00-create-listings-database.sql on 5435) or run preflight without SKIP_PREFLIGHT_MIGRATIONS=1."
  echo ""
  
  # Ensure Kafka is up first (required for analytics-service and auction-monitor)
  say "5a. Ensuring Kafka is accessible..."
  if ! nc -z 127.0.0.1 29093 2>/dev/null && ! nc -z localhost 29093 2>/dev/null; then
    warn "Kafka port 29093 not accessible, starting Kafka..."
    if command -v docker >/dev/null 2>&1; then
      docker compose up -d zookeeper kafka 2>&1 | tail -5 || true
      for i in {1..30}; do
        if nc -z 127.0.0.1 29093 2>/dev/null || nc -z localhost 29093 2>/dev/null; then
          ok "Kafka is now accessible (took ${i}s)"
          break
        fi
        sleep 2
      done
    fi
  else
    ok "Kafka (29093): UP"
  fi
  
  # Diagnose each not-ready service
  say "5b. Diagnosing not-ready services..."
  DIAG_LOG="/tmp/pod-diagnostics-$(date +%Y%m%d-%H%M%S).log"
  echo "Diagnostics log: $DIAG_LOG"
  echo "" > "$DIAG_LOG"
  
  for svc in "${NOT_READY[@]}"; do
    echo "" | tee -a "$DIAG_LOG"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$DIAG_LOG"
    echo "Diagnosing: $svc" | tee -a "$DIAG_LOG"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$DIAG_LOG"
    
    # Get pod name (most recent)
    POD=$(_kubectl get pods -n record-platform -l app="$svc" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$POD" ]]; then
      warn "  No pods found for $svc"
      echo "  No pods found for $svc" >> "$DIAG_LOG"
      continue
    fi
    
    echo "  Pod: $POD" | tee -a "$DIAG_LOG"
    
    # Get pod phase and ready status
    PHASE=$(_kubectl get pod "$POD" -n record-platform -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    READY_STATUS=$(_kubectl get pod "$POD" -n record-platform -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    RESTARTS=$(_kubectl get pod "$POD" -n record-platform -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo "0")
    
    echo "  Phase: $PHASE" | tee -a "$DIAG_LOG"
    echo "  Ready: $READY_STATUS" | tee -a "$DIAG_LOG"
    echo "  Restarts: $RESTARTS" | tee -a "$DIAG_LOG"
    
    # Describe pod (get events and conditions)
    echo "" | tee -a "$DIAG_LOG"
    echo "  === kubectl describe pod $POD ===" | tee -a "$DIAG_LOG"
    _kubectl describe pod "$POD" -n record-platform 2>&1 | tee -a "$DIAG_LOG" | grep -A 20 "Events:" | head -25 || true
    
    # Get container logs (last 50 lines)
    echo "" | tee -a "$DIAG_LOG"
    echo "  === kubectl logs $POD (last 50 lines) ===" | tee -a "$DIAG_LOG"
    _kubectl logs "$POD" -n record-platform --tail=50 2>&1 | tee -a "$DIAG_LOG" | tail -30 || true
    
    # Check for common issues and try to fix
    echo "" | tee -a "$DIAG_LOG"
    echo "  === Attempting fixes ===" | tee -a "$DIAG_LOG"
    
    FIXED_THIS_SERVICE=0
    
    # If pod is Pending or ContainerCreating for too long, delete it
    if [[ "$PHASE" == "Pending" ]] || [[ "$PHASE" == "ContainerCreating" ]]; then
      AGE=$(_kubectl get pod "$POD" -n record-platform -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null || echo "")
      if [[ -n "$AGE" ]]; then
        # Check if pod is older than 2 minutes
        AGE_SEC=$(($(date +%s) - $(date -j -f "%Y-%m-%dT%H:%M:%SZ" "${AGE}Z" +%s 2>/dev/null || echo 0)))
        if [[ $AGE_SEC -gt 120 ]]; then
          warn "  Pod $POD stuck in $PHASE for ${AGE_SEC}s, deleting..."
          echo "  Deleting stuck pod: $POD" | tee -a "$DIAG_LOG"
          _kubectl delete pod "$POD" -n record-platform --force --grace-period=0 2>&1 | tee -a "$DIAG_LOG" || true
          FIXED_THIS_SERVICE=1
        fi
      fi
    fi
    
    # If pod is CrashLoopBackOff, check logs for errors and restart deployment
    if [[ "$PHASE" == "CrashLoopBackOff" ]] || [[ "$RESTARTS" -gt 5 ]]; then
      warn "  Pod $POD in $PHASE with $RESTARTS restarts, restarting deployment..."
      echo "  Restarting deployment: $svc" | tee -a "$DIAG_LOG"
      _kubectl rollout restart deployment "$svc" -n record-platform 2>&1 | tee -a "$DIAG_LOG" || true
      FIXED_THIS_SERVICE=1
    fi
    
    # If FailedMount, check if secret exists
    MOUNT_ERROR=$(_kubectl describe pod "$POD" -n record-platform 2>&1 | grep -i "FailedMount\|MountVolume" | head -1 || echo "")
    if [[ -n "$MOUNT_ERROR" ]]; then
      warn "  Mount error detected: $MOUNT_ERROR"
      echo "  Mount error: $MOUNT_ERROR" | tee -a "$DIAG_LOG"
      # Check if service-tls secret exists
      if ! _kubectl get secret service-tls -n record-platform >/dev/null 2>&1; then
        warn "  service-tls secret missing! This is required."
        echo "  service-tls secret missing!" | tee -a "$DIAG_LOG"
      else
        # Secret exists but mount failed - delete pod to retry
        warn "  Secret exists but mount failed, deleting pod to retry..."
        echo "  Deleting pod to retry mount: $POD" | tee -a "$DIAG_LOG"
        _kubectl delete pod "$POD" -n record-platform --force --grace-period=0 2>&1 | tee -a "$DIAG_LOG" || true
        FIXED_THIS_SERVICE=1
      fi
    fi
    
    # Check for Kafka connection errors (for all services that use Kafka)
    if [[ "$svc" == "analytics-service" ]] || [[ "$svc" == "auction-monitor" ]] || \
       [[ "$svc" == "social-service" ]] || [[ "$svc" == "python-ai-service" ]]; then
      KAFKA_ERROR=$(_kubectl logs "$POD" -n record-platform --tail=100 2>&1 | grep -i "ECONNREFUSED.*9093\|kafka.*connection\|kafka.*error" | head -1 || echo "")
      if [[ -n "$KAFKA_ERROR" ]]; then
        warn "  Kafka connection error detected: $KAFKA_ERROR"
        echo "  Kafka error: $KAFKA_ERROR" | tee -a "$DIAG_LOG"
        # Check kafka-external endpoint
        KAFKA_ENDPOINT_IP=$(_kubectl get endpoints kafka-external -n record-platform -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null || echo "")
        if [[ -z "$KAFKA_ENDPOINT_IP" ]] || [[ "$KAFKA_ENDPOINT_IP" == "10.43"* ]]; then
          warn "  kafka-external endpoint IP is wrong ($KAFKA_ENDPOINT_IP), should be host IP"
          echo "  kafka-external endpoint IP wrong: $KAFKA_ENDPOINT_IP" | tee -a "$DIAG_LOG"
          # Try to get host IP and patch endpoint (use the patch script for consistency)
          if [[ -f "$SCRIPT_DIR/patch-kafka-external-host.sh" ]]; then
            warn "  Patching kafka-external endpoint using patch script..."
            echo "  Patching kafka-external endpoint using patch script" | tee -a "$DIAG_LOG"
            chmod +x "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>/dev/null || true
            "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>&1 | tee -a "$DIAG_LOG" || true
            FIXED_THIS_SERVICE=1
          else
            # Fallback: manual patch
            if command -v colima >/dev/null 2>&1; then
              HOST_IP=$(colima ssh -- ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' | head -1 || echo "")
              [[ -z "$HOST_IP" ]] && HOST_IP="192.168.5.2"
            else
              HOST_IP="192.168.5.2"
            fi
            warn "  Patching kafka-external endpoint to $HOST_IP:29093..."
            echo "  Patching kafka-external endpoint to $HOST_IP:29093" | tee -a "$DIAG_LOG"
            _kubectl patch endpoints kafka-external -n record-platform --type=merge -p="{\"subsets\":[{\"addresses\":[{\"ip\":\"$HOST_IP\"}],\"ports\":[{\"port\":29093,\"name\":\"kafka-ssl\"}]}]}" 2>&1 | tee -a "$DIAG_LOG" || true
            FIXED_THIS_SERVICE=1
          fi
        fi
      fi
    fi
    
    # Check for health probe errors
    PROBE_ERROR=$(_kubectl describe pod "$POD" -n record-platform 2>&1 | grep -i "startup probe failed\|liveness probe failed\|readiness probe failed" | head -1 || echo "")
    if [[ -n "$PROBE_ERROR" ]]; then
      warn "  Health probe error: $PROBE_ERROR"
      echo "  Probe error: $PROBE_ERROR" | tee -a "$DIAG_LOG"
      # If it's a TLS/probe config issue, delete pod to retry
      if echo "$PROBE_ERROR" | grep -qi "tls\|cert"; then
        warn "  TLS/probe config issue detected, deleting pod to retry..."
        echo "  Deleting pod due to probe error: $POD" | tee -a "$DIAG_LOG"
        _kubectl delete pod "$POD" -n record-platform --force --grace-period=0 2>&1 | tee -a "$DIAG_LOG" || true
        FIXED_THIS_SERVICE=1
      fi
    fi
    
    if [[ $FIXED_THIS_SERVICE -eq 1 ]]; then
      echo "  ✅ Applied fixes for $svc" | tee -a "$DIAG_LOG"
    else
      echo "  ⚠️  No automatic fixes available for $svc" | tee -a "$DIAG_LOG"
    fi
  done
  
  echo "" | tee -a "$DIAG_LOG"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$DIAG_LOG"
  ok "Diagnostics complete. Log: $DIAG_LOG"
  
  # Wait a bit for fixes to take effect (longer if we made fixes)
  say "5c. Waiting for fixes to take effect..."
  sleep 20
  
  # Re-check
  say "5d. Re-checking service pods after fixes..."
  READY=0
  for svc in "${SERVICES[@]}"; do
    R=$(_kubectl get deploy -n record-platform "$svc" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    S=$(_kubectl get deploy -n record-platform "$svc" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
    [[ -z "$R" ]] && R="0"
    [[ -z "$S" ]] && S="1"
    if [[ "$R" == "1" && "$S" == "1" ]]; then
      ((READY++)) || true
      ok "$svc: 1/1"
    else
      warn "$svc: $R/$S"
    fi
  done
fi

[[ "${READY:-0}" -eq 9 ]] && ok "All 9 services Ready (1/1)" || warn "Only ${READY:-0}/9 services Ready"

# 6. Exporters (record-platform, 1/1 each)
say "6. Checking exporters (record-platform, 1/1 each)..."
for ex in nginx-exporter haproxy-exporter; do
  R=$(_kubectl get deploy -n record-platform "$ex" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  S=$(_kubectl get deploy -n record-platform "$ex" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
  [[ -z "$R" ]] && R="0"; [[ -z "$S" ]] && S="1"
  if [[ "$R" == "1" && "$S" == "1" ]]; then
    ok "$ex: 1/1"
  else
    warn "$ex: $R/$S"
    [[ "$ex" == "nginx-exporter" ]] && echo "    ℹ️  nginx-exporter waits on nginx:8080/nginx_status (init container); ensure nginx is Running"
  fi
done

# 7. Envoy (envoy-test namespace, 1 pod)
say "7. Checking Envoy (envoy-test, 1 pod)..."
ENVOY_R=$(_kubectl get deploy -n envoy-test envoy-test -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
ENVOY_S=$(_kubectl get deploy -n envoy-test envoy-test -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
[[ -z "$ENVOY_R" ]] && ENVOY_R="0"; [[ -z "$ENVOY_S" ]] && ENVOY_S="1"
if [[ "$ENVOY_R" == "1" && "$ENVOY_S" == "1" ]]; then
  ok "envoy-test: 1/1"
else
  warn "envoy-test: $ENVOY_R/$ENVOY_S"
fi

# 8. Caddy (ingress-nginx, 2 pods)
say "8. Checking Caddy (ingress-nginx, 2 pods)..."
CADDY_R=$(_kubectl get deploy -n ingress-nginx caddy-h3 -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
CADDY_S=$(_kubectl get deploy -n ingress-nginx caddy-h3 -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "2")
[[ -z "$CADDY_R" ]] && CADDY_R="0"; [[ -z "$CADDY_S" ]] && CADDY_S="2"
if [[ "$CADDY_R" == "2" && "$CADDY_S" == "2" ]]; then
  ok "caddy-h3: 2/2"
else
  warn "caddy-h3: $CADDY_R/$CADDY_S"
fi

# 9. Unwanted pods: only in-cluster postgres (external Kafka; no in-cluster Kafka/ZK)
say "9. Checking no in-cluster postgres..."
UNWANTED=$(_kubectl get pods -n record-platform -l 'app=postgres' --no-headers 2>/dev/null | wc -l | tr -d ' ' || echo "0")
[[ "${UNWANTED:-0}" -eq 0 ]] && ok "No in-cluster postgres" || warn "Found ${UNWANTED:-0} in-cluster postgres pod(s) (external PG expected)"

# 10. TLS secrets (dev-root-ca + record-local-tls for CA/Caddy match)
say "10. Checking TLS secrets..."
[[ -n "$(_kubectl get secret -n ingress-nginx dev-root-ca -o name 2>/dev/null)" ]] && ok "dev-root-ca (ingress-nginx)" || warn "dev-root-ca missing"
# record-local-tls should exist in ingress-nginx namespace (for Caddy)
if [[ -n "$(_kubectl get secret -n ingress-nginx record-local-tls -o name 2>/dev/null)" ]]; then
  ok "record-local-tls (ingress-nginx)"
else
  warn "record-local-tls missing in ingress-nginx (run: pnpm run reissue)"
fi

say "=== Check Complete ==="
exit 0
