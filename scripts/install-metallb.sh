#!/usr/bin/env bash
# Install MetalLB (controller + speaker) and apply pool + L2. Use with k3d or Colima k3s.
# Env: METALLB_POOL (optional) e.g. 172.18.0.240-172.18.0.250 (k3d) or 192.168.106.240-192.168.106.250 (Colima).
#      MAX_RETRIES (default 24 for API wait), METALLB_MANIFEST_URL (default v0.14.3).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
METALLB_MANIFEST_URL="${METALLB_MANIFEST_URL:-https://raw.githubusercontent.com/metallb/metallb/v0.14.3/config/manifests/metallb-native.yaml}"
MAX_RETRIES="${MAX_RETRIES:-24}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

# Wait for API
say "Waiting for API server..."
for i in $(seq 1 "$MAX_RETRIES"); do
  if kubectl get ns default --request-timeout=5s >/dev/null 2>&1; then
    ok "API ready"
    break
  fi
  [[ $i -eq "$MAX_RETRIES" ]] && { warn "API not ready after ${MAX_RETRIES} attempts"; exit 1; }
  sleep "$RETRY_SLEEP"
done

# Apply MetalLB manifest
say "Applying MetalLB manifest..."
if ! kubectl apply -f "$METALLB_MANIFEST_URL" --request-timeout=60s 2>/dev/null; then
  curl -sSL "$METALLB_MANIFEST_URL" | kubectl apply -f - --request-timeout=60s 2>/dev/null || { warn "MetalLB manifest apply failed"; exit 1; }
fi
ok "MetalLB manifest applied"

# Wait for metallb-system namespace and controller
say "Waiting for MetalLB controller..."
for i in $(seq 1 "$MAX_RETRIES"); do
  if kubectl get deployment -n metallb-system controller --request-timeout=5s >/dev/null 2>&1; then
    if kubectl rollout status deployment/controller -n metallb-system --timeout=90s 2>/dev/null; then
      ok "MetalLB controller ready"
      break
    fi
  fi
  [[ $i -eq "$MAX_RETRIES" ]] && { warn "MetalLB controller not ready in time; pool apply may fail"; }
  sleep "$RETRY_SLEEP"
done

# Optional: wait for webhook (avoids "endpoints webhook-service not found" on pool apply)
for i in $(seq 1 12); do
  if kubectl get endpoints webhook-service -n metallb-system --request-timeout=3s 2>/dev/null | grep -q .; then
    ok "MetalLB webhook has endpoints"
    break
  fi
  sleep 5
done

# Pool + L2: use repo YAMLs; override pool addresses if METALLB_POOL set
POOL_FILE="$REPO_ROOT/infra/k8s/metallb/ipaddresspool.yaml"
L2_FILE="$REPO_ROOT/infra/k8s/metallb/l2advertisement.yaml"

if [[ -f "$POOL_FILE" ]]; then
  say "Applying MetalLB pool and L2..."
  if [[ -n "${METALLB_POOL:-}" ]]; then
    _tmp=$(mktemp -t metallb-pool.XXXXXX.yaml)
    sed "s|^  - [0-9].*|  - ${METALLB_POOL}|" "$POOL_FILE" > "$_tmp"
    kubectl apply -f "$_tmp" --request-timeout=20s 2>/dev/null && ok "IPAddressPool applied (METALLB_POOL=$METALLB_POOL)" || warn "Pool apply had issues"
    rm -f "$_tmp"
  else
    kubectl apply -f "$POOL_FILE" --request-timeout=20s 2>/dev/null && ok "IPAddressPool applied" || warn "Pool apply had issues"
  fi
else
  warn "Pool file not found: $POOL_FILE"
fi

if [[ -f "$L2_FILE" ]]; then
  kubectl apply -f "$L2_FILE" --request-timeout=20s 2>/dev/null && ok "L2Advertisement applied" || warn "L2 apply had issues"
else
  warn "L2 file not found: $L2_FILE"
fi

ok "MetalLB install complete. LoadBalancer services will get an IP from the pool once assigned."
