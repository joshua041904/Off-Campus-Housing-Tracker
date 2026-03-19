#!/usr/bin/env bash
# Re-apply MetalLB pool (with Colima VM subnet auto-detect) and recreate caddy-h3 service so EXTERNAL-IP gets assigned.
# Use when: IPAddressPool has no addresses, or EXTERNAL-IP stays <pending> (pool wrong subnet).
# MetalLB is already installed by setup-new-colima-cluster.sh; this only fixes the pool and service.
#
# Usage: ./scripts/apply-metallb-pool-colima.sh
#   METALLB_POOL=192.168.64.240-192.168.64.250   override (else auto-detect from colima ssh eth0)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
NS_ING="${NS_ING:-ingress-nginx}"

# Auto-detect pool from cluster node InternalIP first (works even if Colima VM subnet changed).
if [[ -z "${METALLB_POOL:-}" ]]; then
  NODE_IP_RAW="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || true)"
  NODE_IP="$(printf '%s\n' "$NODE_IP_RAW" | awk '{for(i=1;i<=NF;i++) if ($i ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) {print $i; exit}}')"
  if [[ -n "$NODE_IP" ]]; then
    NODE_SUBNET="$(echo "$NODE_IP" | awk -F. '{print $1"."$2"."$3}')"
    METALLB_POOL="${NODE_SUBNET}.240-${NODE_SUBNET}.250"
    echo "Auto-detected node InternalIP subnet ${NODE_SUBNET}.x (node ${NODE_IP}); using METALLB_POOL=${METALLB_POOL}"
  fi
fi
# Fallback to Colima eth0 if node lookup is unavailable.
if [[ -z "${METALLB_POOL:-}" ]] && command -v colima &>/dev/null 2>&1; then
  VM_INET="$(colima ssh -- ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2; exit}' | cut -d/ -f1 || true)"
  if [[ -n "$VM_INET" ]]; then
    VM_SUBNET="$(echo "$VM_INET" | cut -d. -f1-3)"
    METALLB_POOL="${VM_SUBNET}.240-${VM_SUBNET}.250"
    echo "Fallback auto-detected Colima subnet ${VM_SUBNET}.x (eth0 ${VM_INET}); using METALLB_POOL=${METALLB_POOL}"
  fi
fi
METALLB_POOL="${METALLB_POOL:-192.168.64.240-192.168.64.250}"

echo "Applying IPAddressPool and L2Advertisement (pool: $METALLB_POOL)..."
sed "s|\$METALLB_POOL|$METALLB_POOL|g" "$REPO_ROOT/infra/k8s/metallb/ipaddresspool.yaml" | kubectl apply -f - --validate=false
kubectl apply -f "$REPO_ROOT/infra/k8s/metallb/l2advertisement.yaml" --validate=false
echo "Recreating caddy-h3 service so MetalLB assigns an IP..."
kubectl delete svc caddy-h3 -n "$NS_ING" --ignore-not-found --request-timeout=10s
kubectl apply -f "$REPO_ROOT/infra/k8s/loadbalancer.yaml"
echo "Waiting for EXTERNAL-IP to be assigned..."
for i in $(seq 1 30); do
  ext_ip=$(kubectl -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -n "$ext_ip" ]] && [[ "$ext_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "caddy-h3 EXTERNAL-IP: $ext_ip"
    echo "Done. Verify: kubectl get svc -n $NS_ING"
    echo "Then: curl -k --http3 https://$ext_ip/_caddy/healthz  (or add $ext_ip off-campus-housing.local to /etc/hosts)"
    exit 0
  fi
  sleep 2
done
echo "EXTERNAL-IP still pending after 60s. Check: kubectl -n metallb-system get ipaddresspool -o yaml"
exit 1
