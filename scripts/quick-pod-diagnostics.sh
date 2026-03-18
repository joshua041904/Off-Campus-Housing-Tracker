#!/usr/bin/env bash
# Quick focused diagnostics for pods that are not ready
# Faster than deep-dive, focuses on problem pods only

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
fail(){ echo "❌ $*" >&2; }

NS="off-campus-housing-tracker"
SERVICES=("auth-service" "listings-service" "booking-service" "messaging-service" "trust-service" "analytics-service" "api-gateway")

say "=== Quick Pod Diagnostics (Problem Pods Only) ==="

# Find all not-ready pods
say "1. Finding not-ready pods..."
NOT_READY_PODS=()
for service in "${SERVICES[@]}"; do
  ready=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(_kubectl get deployment "$service" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
  
  if [[ "$ready" != "$desired" ]] || [[ "$ready" != "1" ]]; then
    pod=$(_kubectl get pods -n "$NS" -l app="$service" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$pod" ]]; then
      NOT_READY_PODS+=("$NS/$pod")
      echo "  ⚠️  $service: $ready/$desired (pod: $pod)"
    fi
  fi
done

if [[ ${#NOT_READY_PODS[@]} -eq 0 ]]; then
  ok "All service pods are ready!"
  exit 0
fi

say "2. Diagnosing ${#NOT_READY_PODS[@]} not-ready pod(s)..."

for pod_path in "${NOT_READY_PODS[@]}"; do
  ns="${pod_path%%/*}"
  pod="${pod_path#*/}"
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  say "Pod: $pod (namespace: $ns)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Basic status
  phase=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
  ready=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
  restart_count=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo "0")
  
  echo "  Phase: $phase"
  echo "  Ready: $ready"
  echo "  Restarts: $restart_count"
  
  # Container state
  waiting_reason=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || echo "")
  waiting_message=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].state.waiting.message}' 2>/dev/null || echo "")
  terminated_reason=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].state.terminated.reason}' 2>/dev/null || echo "")
  terminated_message=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].state.terminated.message}' 2>/dev/null || echo "")
  
  if [[ -n "$waiting_reason" ]]; then
    echo "  ⚠️  Waiting: $waiting_reason"
    [[ -n "$waiting_message" ]] && echo "     Message: $waiting_message"
  fi
  
  if [[ -n "$terminated_reason" ]]; then
    echo "  ⚠️  Terminated: $terminated_reason"
    [[ -n "$terminated_message" ]] && echo "     Message: $terminated_message"
  fi
  
  # Ready condition
  ready_condition=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.conditions[?(@.type=="Ready")]}' 2>/dev/null || echo "")
  if echo "$ready_condition" | grep -q "False"; then
    ready_reason=$(echo "$ready_condition" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "")
    ready_message=$(echo "$ready_condition" | grep -o '"message":"[^"]*"' | cut -d'"' -f4 || echo "")
    echo "  ⚠️  Ready condition: False"
    [[ -n "$ready_reason" ]] && echo "     Reason: $ready_reason"
    [[ -n "$ready_message" ]] && echo "     Message: $ready_message"
  fi
  
  # Recent events (last 5)
  echo ""
  echo "  Recent events:"
  _kubectl get events -n "$ns" --field-selector involvedObject.name="$pod" --sort-by='.lastTimestamp' --request-timeout=8s 2>/dev/null | tail -5 | while read line; do
    [[ -n "$line" ]] && echo "    $line"
  done || echo "    (no events)"
  
  # If Running but not ready, check logs and internal state
  if [[ "$phase" == "Running" ]] && [[ "$ready" != "true" ]]; then
    echo ""
    echo "  📋 Container logs (last 20 lines):"
    _kubectl logs "$pod" -n "$ns" --tail=20 --request-timeout=8s 2>&1 | tail -20 | sed 's/^/    /' || echo "    (logs unavailable)"
    
    # Check if Node.js service
    container_image=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || echo "")
    if echo "$container_image" | grep -qE "(auth-service|listings-service|booking-service|messaging-service|trust-service|analytics-service)"; then
      echo ""
      echo "  🔍 Node.js service checks:"
      
      # Check dist/server.js
      if _kubectl exec "$pod" -n "$ns" -- test -f /app/dist/server.js 2>/dev/null; then
        echo "    ✅ /app/dist/server.js exists"
      else
        echo "    ❌ /app/dist/server.js NOT FOUND"
        echo "    📁 /app/dist contents:"
        _kubectl exec "$pod" -n "$ns" -- ls -la /app/dist/ 2>/dev/null | head -5 | sed 's/^/      /' || echo "      (directory not accessible)"
      fi
      
      # Check Node.js process
      node_pid=$(_kubectl exec "$pod" -n "$ns" -- pgrep -f "node.*server.js" 2>/dev/null || echo "")
      if [[ -n "$node_pid" ]]; then
        echo "    ✅ Node.js process running (PID: $node_pid)"
      else
        echo "    ❌ No Node.js process found"
      fi
      
      # Check gRPC port
      grpc_port=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.containers[0].ports[?(@.name=="grpc")].containerPort}' 2>/dev/null || echo "")
      if [[ -n "$grpc_port" ]]; then
        if _kubectl exec "$pod" -n "$ns" -- sh -c "ss -tln 2>/dev/null | grep -q ':$grpc_port '" 2>/dev/null || _kubectl exec "$pod" -n "$ns" -- sh -c "netstat -tln 2>/dev/null | grep -q ':$grpc_port '" 2>/dev/null; then
          echo "    ✅ gRPC port $grpc_port is listening"
        else
          echo "    ❌ gRPC port $grpc_port is NOT listening"
        fi
      fi
    fi
    
    # Check if Python service
    if echo "$container_image" | grep -q "notification-service"; then
      echo ""
      echo "  🔍 Python service checks:"
      python_pid=$(_kubectl exec "$pod" -n "$ns" -- pgrep -f python 2>/dev/null || echo "")
      if [[ -n "$python_pid" ]]; then
        echo "    ✅ Python process running (PID: $python_pid)"
      else
        echo "    ❌ No Python process found"
      fi
    fi
  fi
done

say "=== Diagnostics Complete ==="
