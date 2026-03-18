#!/usr/bin/env bash
# Deep dive diagnostics for ALL pods across ALL namespaces
# Finds root causes of pod readiness issues

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh" || true
_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; }

NS="record-platform"
INGRESS_NS="ingress-nginx"
ENVOY_NS="envoy-test"

say "=== Deep Dive Pod Diagnostics (All Namespaces) ==="

# Get all namespaces
say "1. Listing all namespaces..."
NAMESPACES=$(_kubectl get namespaces -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
echo "Namespaces: $NAMESPACES"

# Check each namespace for pods
for ns in $NAMESPACES; do
  say "2. Checking namespace: $ns"
  
  # Get all pods in namespace
  PODS=$(_kubectl get pods -n "$ns" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
  
  if [[ -z "$PODS" ]]; then
    echo "  No pods in $ns"
    continue
  fi
  
  for pod in $PODS; do
    echo ""
    echo "  --- Pod: $pod (namespace: $ns) ---"
    
    # Get pod phase and ready status
    phase=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    ready=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    restart_count=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo "0")
    
    echo "    Phase: $phase"
    echo "    Ready: $ready"
    echo "    Restarts: $restart_count"
    
    # Get container status
    waiting_reason=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || echo "")
    if [[ -n "$waiting_reason" ]]; then
      waiting_message=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.containerStatuses[0].state.waiting.message}' 2>/dev/null || echo "")
      echo "    ⚠️  Waiting: $waiting_reason"
      [[ -n "$waiting_message" ]] && echo "       Message: $waiting_message"
    fi
    
    # Check readiness probe failures
    ready_condition=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.conditions[?(@.type=="Ready")]}' 2>/dev/null || echo "")
    if echo "$ready_condition" | grep -q "False"; then
      ready_message=$(echo "$ready_condition" | grep -o '"message":"[^"]*"' | cut -d'"' -f4 || echo "")
      ready_reason=$(echo "$ready_condition" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "")
      echo "    ⚠️  Ready condition: False"
      [[ -n "$ready_reason" ]] && echo "       Reason: $ready_reason"
      [[ -n "$ready_message" ]] && echo "       Message: $ready_message"
    fi
    
    # Get recent events
    echo "    Recent events:"
    _kubectl get events -n "$ns" --field-selector involvedObject.name="$pod" --sort-by='.lastTimestamp' --request-timeout=10s 2>/dev/null | tail -5 | while read line; do
      [[ -n "$line" ]] && echo "      $line"
    done || echo "      (no events)"
    
    # For not-ready pods, check logs
    if [[ "$ready" != "true" ]] && [[ "$phase" == "Running" ]]; then
      echo "    📋 Container logs (last 30 lines):"
      _kubectl logs "$pod" -n "$ns" --tail=30 --request-timeout=10s 2>&1 | tail -30 | sed 's/^/      /' || echo "      (logs unavailable)"
      
      # Check if it's a Node.js service - verify dist/server.js exists
      container_image=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || echo "")
      if echo "$container_image" | grep -qE "(auth-service|records-service|listings-service|social-service|shopping-service|analytics-service|auction-monitor)"; then
        echo "    🔍 Checking for dist/server.js..."
        if _kubectl exec "$pod" -n "$ns" -- ls -la /app/dist/server.js 2>/dev/null >/dev/null; then
          echo "      ✅ /app/dist/server.js exists"
        else
          echo "      ❌ /app/dist/server.js NOT FOUND"
          echo "      📁 Listing /app/dist contents:"
          _kubectl exec "$pod" -n "$ns" -- ls -la /app/dist/ 2>/dev/null | head -10 | sed 's/^/        /' || echo "        (directory not accessible)"
        fi
        
        # Check if Node.js process is running
        echo "    🔍 Checking for Node.js process..."
        node_process=$(_kubectl exec "$pod" -n "$ns" -- ps aux 2>/dev/null | grep -E "node|npm" | head -3 || echo "")
        if [[ -n "$node_process" ]]; then
          echo "      ✅ Node.js process found:"
          echo "$node_process" | sed 's/^/        /'
        else
          echo "      ❌ No Node.js process found"
        fi
        
        # Check if gRPC port is listening
        grpc_port=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.containers[0].ports[?(@.name=="grpc")].containerPort}' 2>/dev/null || echo "")
        if [[ -n "$grpc_port" ]]; then
          echo "    🔍 Checking if gRPC port $grpc_port is listening..."
          if _kubectl exec "$pod" -n "$ns" -- netstat -tln 2>/dev/null | grep -q ":$grpc_port " || _kubectl exec "$pod" -n "$ns" -- ss -tln 2>/dev/null | grep -q ":$grpc_port "; then
            echo "      ✅ Port $grpc_port is listening"
          else
            echo "      ❌ Port $grpc_port is NOT listening"
          fi
        fi
      fi
      
      # Check if it's Python service
      if echo "$container_image" | grep -q "python-ai-service"; then
        echo "    🔍 Checking Python service..."
        if _kubectl exec "$pod" -n "$ns" -- ps aux 2>/dev/null | grep -q python; then
          echo "      ✅ Python process found"
        else
          echo "      ❌ No Python process found"
        fi
      fi
    fi
  done
done

# Summary of not-ready pods
say "3. Summary of Not-Ready Pods"
NOT_READY_COUNT=0
for ns in $NAMESPACES; do
  NOT_READY_PODS=$(_kubectl get pods -n "$ns" --field-selector=status.phase=Running -o jsonpath='{range .items[?(@.status.containerStatuses[0].ready==false)]}{.metadata.name}{"\n"}{end}' 2>/dev/null || echo "")
  if [[ -n "$NOT_READY_PODS" ]]; then
    for pod in $NOT_READY_PODS; do
      ((NOT_READY_COUNT++))
      ready_condition=$(_kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.conditions[?(@.type=="Ready")].reason}' 2>/dev/null || echo "Unknown")
      echo "  ❌ $ns/$pod: $ready_condition"
    done
  fi
done

if [[ $NOT_READY_COUNT -eq 0 ]]; then
  ok "All pods are ready!"
else
  warn "$NOT_READY_COUNT pod(s) not ready"
fi

say "=== Diagnostics Complete ==="
