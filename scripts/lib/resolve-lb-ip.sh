# resolve-lb-ip.sh — Dynamically get Caddy LoadBalancer IP from cluster.
# MetalLB can reassign IP after Caddy rollout; never hardcode. Source this in scripts that need LB IP.
#
# Usage: source scripts/lib/resolve-lb-ip.sh
# Sets: TARGET_IP, REACHABLE_LB_IP (when caddy-h3 has LoadBalancer IP)

get_caddy_lb_ip() {
  local _kctl="${KUBECTL_FOR_LB:-kubectl}"
  local _ip
  _ip=$("$_kctl" -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  [[ -z "$_ip" ]] && _ip=$("$_kctl" -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
  echo "$_ip"
}

# Resolve and export when caddy-h3 has LoadBalancer
CADDY_LB_IP=$(get_caddy_lb_ip)
if [[ -n "$CADDY_LB_IP" ]]; then
  export TARGET_IP="$CADDY_LB_IP"
  export REACHABLE_LB_IP="$CADDY_LB_IP"
else
  # EXTERNAL-IP <pending>: clear stale values so callers don't use old IP
  unset TARGET_IP REACHABLE_LB_IP 2>/dev/null || true
fi
