#!/usr/bin/env bash
# Verify MetalLB + Caddy H3 (LoadBalancer IP). Two modes: stable (correctness, CI baseline) and chaos (recovery).
#
# VERIFY_MODE=stable (default)
#   Correctness only. No speaker restart, no ARP simulation, no pool churn.
#   Steps: MetalLB components, pool, LB IP, host reachability, HTTP/1.1, HTTP/2, HTTP/3 via LB IP.
#   HTTP/3: On Colima, step 6 (in-cluster hostNetwork pod) is authoritative; step 6a reuses that result
#   and does not require host curl (macOS default curl lacks --http3-only). For host QUIC use Homebrew curl.
#
# VERIFY_MODE=chaos
#   Control-plane stress (verify-metallb-advanced.sh: speaker restart, ARP sim, route flaps, etc.).
#   HTTP/3 may temporarily fail; must recover within 30s (10 attempts, 3s apart) after chaos. Fail only if recovery does not occur.
#
# Use: ./scripts/verify-metallb-and-traffic-policy.sh
#   VERIFY_MODE=stable|chaos   default: stable
#   SKIP_IN_CLUSTER_CURL=1    skip in-cluster Caddy health check
#   SKIP_HOST_CURL=1          skip host curl to LB IP
#   SKIP_LB_IP_SETUP=1        skip socat (default 1 on Colima = MetalLB IP only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

# Prefer Homebrew curl for HTTP/3 (ngtcp2); run "brew upgrade curl" if --http3 fails
CURL_BIN="${CURL_BIN:-}"
_curl_has_http3() { [[ -x "${1:-}" ]] && "$1" --help all 2>/dev/null | grep -q -- "--http3"; }
if [[ -z "$CURL_BIN" ]]; then
  _curl_has_http3 /opt/homebrew/opt/curl/bin/curl && CURL_BIN="/opt/homebrew/opt/curl/bin/curl"
  [[ -z "$CURL_BIN" ]] && _curl_has_http3 /usr/local/opt/curl/bin/curl && CURL_BIN="/usr/local/opt/curl/bin/curl"
fi
[[ -z "$CURL_BIN" ]] && CURL_BIN="curl"

NS_METALLB="${NS_METALLB:-metallb-system}"
NS_ING="${NS_ING:-ingress-nginx}"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "ℹ️  $*"; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
# Stable = correctness only (no chaos). Chaos = advanced + recovery.
VERIFY_MODE="${VERIFY_MODE:-stable}"
[[ "$VERIFY_MODE" != "chaos" ]] && VERIFY_MODE="stable"
# Backward compat: SKIP_METALLB_ADVANCED=1 => stable (no advanced/chaos)
[[ "${SKIP_METALLB_ADVANCED:-0}" == "1" ]] && VERIFY_MODE="stable"
# Fail fast if API is unreachable (e.g. Colima stopped)
if ! kubectl get ns --request-timeout=10s &>/dev/null; then
  echo "❌ Cannot reach Kubernetes API (e.g. connection refused to 127.0.0.1:6443). Start the cluster (e.g. colima start) and retry." >&2
  exit 1
fi
# Normalize HTTP code to 3 chars for display (curl can return empty or 000000 on failure)
_normalize_http_code() { local c="${1:-000}"; c="${c:0:3}"; echo "${c:-000}"; }
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || true
  fi
}

say "=== MetalLB and Traffic Policy Verification ==="
info "Context: $ctx"
if [[ "$VERIFY_MODE" == "stable" ]]; then
  info "Mode: stable — correctness only (no speaker restart, no ARP/pool churn). HTTP/3 must pass within 15s retry."
else
  info "Mode: chaos — control-plane stress; HTTP/3 may temporarily fail but must recover within 30s."
fi
# MetalLB-only on Colima: no socat; host must reach LB IP directly (METALLB_POOL on VM network).
if [[ "$ctx" == *"colima"* ]]; then
  info "Colima — MetalLB IP only (no socat). METALLB_POOL on VM network (e.g. 192.168.64.240-192.168.64.250)."
  [[ -z "${SKIP_LB_IP_SETUP:-}" ]] && SKIP_LB_IP_SETUP=1
elif [[ "$ctx" == *"k3d"* ]]; then
  info "k3d — set SKIP_LB_IP_SETUP=0 to run socat for host→LB IP; else in-cluster only. See docs/K3D_METALLB_INGRESS_EGRESS.md"
fi

# 1. MetalLB namespace and controller/speaker
say "1. MetalLB components (namespace, controller, speaker)"
if ! _kb get ns "$NS_METALLB" -o name >/dev/null 2>&1; then
  fail "MetalLB namespace $NS_METALLB not found. Install with: ./scripts/install-metallb-chunked.sh or install-metallb.sh"
fi
ok "MetalLB namespace exists"

# Wait for controller to become ready (longer on k3d after node restart; can take 1–2 min)
_controller_timeout=30
[[ "$ctx" == *"k3d"* ]] && _controller_timeout=120
# Use variables for jsonpath to avoid brace/shell parsing issues in some environments
_jsonpath_ready='{.status.readyReplicas}'
_jsonpath_replicas='{.spec.replicas}'
controller_ready=$(_kb -n "$NS_METALLB" get deploy controller -o jsonpath="$_jsonpath_ready" 2>/dev/null || echo "0")
controller_desired=$(_kb -n "$NS_METALLB" get deploy controller -o jsonpath="$_jsonpath_replicas" 2>/dev/null || echo "1")
waited=0
while [[ "${controller_ready:-0}" -lt 1 ]] && [[ "$waited" -lt $_controller_timeout ]]; do
  info "Waiting for MetalLB controller to be ready (${waited}s)..."
  sleep 5
  waited=$((waited + 5))
  controller_ready=$(_kb -n "$NS_METALLB" get deploy controller -o jsonpath="$_jsonpath_ready" 2>/dev/null || echo "0")
  controller_desired=$(_kb -n "$NS_METALLB" get deploy controller -o jsonpath="$_jsonpath_replicas" 2>/dev/null || echo "1")
done
if [[ "${controller_ready:-0}" -lt 1 ]]; then
  _msg="MetalLB controller not ready (ready=${controller_ready:-0} desired=${controller_desired:-1}). Check: kubectl get deploy -n ${NS_METALLB}"
  warn "$_msg"
  info "Continuing; Caddy may use NodePort 30443 if LoadBalancer stays pending. On k3d after node restart, controller can take 1-2 min."
else
  _msg="MetalLB controller ready (${controller_ready}/${controller_desired})"
  ok "$_msg"
fi

speaker_desired=$(_kb -n "$NS_METALLB" get daemonset speaker -o jsonpath='{.status.desiredNumberScheduled}' 2>/dev/null || echo "0")
speaker_ready=$(_kb -n "$NS_METALLB" get daemonset speaker -o jsonpath='{.status.numberReady}' 2>/dev/null || echo "0")
if [[ "${speaker_ready:-0}" -lt 1 ]]; then
  warn "MetalLB speaker DaemonSet not ready (desired=$speaker_desired ready=$speaker_ready). L2 may not advertise."
else
  ok "MetalLB speaker ready ($speaker_ready node(s))"
fi

# 2. IPAddressPool and L2Advertisement (and pool addresses)
say "2. IPAddressPool and L2Advertisement"
_pool_name=""
for _p in off-campus-housing-tracker-pool default-pool default; do
  if _kb -n "$NS_METALLB" get ipaddresspool "$_p" -o name >/dev/null 2>&1; then
    _pool_name="$_p"
    break
  fi
done
if [[ -z "$_pool_name" ]]; then
  warn "IPAddressPool off-campus-housing-tracker-pool not found. Apply infra/k8s/metallb/ (or install script)."
else
  ok "IPAddressPool $_pool_name exists"
  # MetalLB v1beta1: spec.addresses is an array; jsonpath .spec.addresses[*] can be empty via colima ssh. Try multiple extractions.
  pool_addrs=$(_kb -n "$NS_METALLB" get ipaddresspool "$_pool_name" -o jsonpath='{.spec.addresses[*]}' 2>/dev/null || echo "")
  if [[ -z "$pool_addrs" ]]; then
    pool_addrs=$(_kb -n "$NS_METALLB" get ipaddresspool "$_pool_name" -o jsonpath='{.spec.addresses}' 2>/dev/null || echo "")
  fi
  if [[ -z "$pool_addrs" ]]; then
    _pool_yaml=$(_kb -n "$NS_METALLB" get ipaddresspool "$_pool_name" -o yaml 2>/dev/null || echo "")
    pool_addrs=$(echo "$_pool_yaml" | grep -E '^\s+-\s+[0-9]' | sed 's/^[[:space:]]*-[[:space:]]*//' | tr '\n' ' ' | sed 's/ $//' || true)
  fi
  if [[ -z "$pool_addrs" ]]; then
    warn "IPAddressPool $_pool_name has no addresses (check spec.addresses). If LoadBalancer already has an IP, pool may be fine."
  else
    info "Pool addresses: $pool_addrs"
  fi
fi
if ! _kb -n "$NS_METALLB" get l2advertisement off-campus-housing-tracker-l2 -o name >/dev/null 2>&1; then
  warn "L2Advertisement off-campus-housing-tracker-l2 not found. Custom traffic policy (L2 + optional nodeSelector) is in docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md"
else
  ok "L2Advertisement off-campus-housing-tracker-l2 exists (L2 mode; nodeSelector for priority in doc)"
fi

# 3. All LoadBalancer services and at least one with external IP
say "3. LoadBalancer services (all namespaces)"
lb_ip=""
# Prefer caddy-h3 so we never use another LoadBalancer (e.g. multi-subnet leftover) for host/HTTP/3 checks
lb_ip=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  ns=$(echo "$line" | awk '{print $1}')
  name=$(echo "$line" | awk '{print $2}')
  ext_ip=$(echo "$line" | awk '{print $4}')
  if [[ -z "$ext_ip" ]]; then
    warn "  $ns/$name EXTERNAL-IP <pending>"
  else
    ok "  $ns/$name EXTERNAL-IP $ext_ip"
    [[ -z "$lb_ip" ]] && lb_ip="$ext_ip"
  fi
done < <(_kb get svc -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,TYPE:.spec.type,EXTERNAL:.status.loadBalancer.ingress[0].ip --no-headers 2>/dev/null | awk '$3=="LoadBalancer"')
if [[ -z "$lb_ip" ]]; then
  lb_ip=$(_kb get svc -A -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' 2>/dev/null | head -1 || echo "")
fi
if [[ -z "$lb_ip" ]]; then
  warn "No LoadBalancer service has an external IP yet. Caddy-h3 may still be Pending; wait or check METALLB_POOL."
else
  ok "At least one LoadBalancer has external IP (e.g. $lb_ip)"
  # Colima: LB pool must be on VM L2 (eth0 = 192.168.5.x). If pool is 192.168.1.x (home LAN), host can't reach → socat fallback → HTTP/3 fails.
  if [[ "$ctx" == *"colima"* ]] && [[ "$lb_ip" == 192.168.1.* ]]; then
    warn "LB IP $lb_ip is on 192.168.1.x (home LAN); Colima VM is on 192.168.5.x. Host cannot reach LB directly → HTTP/3 will fail. Fix: METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/apply-metallb-pool-colima.sh  then recreate caddy-h3 svc if needed."
  fi
fi

# 4. In-cluster curl to Caddy (uses cluster DNS caddy-h3.ingress-nginx.svc.cluster.local; proves Caddy + TLS path)
say "4. In-cluster path (Caddy via cluster DNS)"
if [[ "${SKIP_IN_CLUSTER_CURL:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" ]]; then
  info "Running in-cluster Caddy health check (curl to caddy-h3.ingress-nginx.svc.cluster.local)..."
  _caddy_err=$(mktemp 2>/dev/null || echo "/tmp/metallb-caddy-$$.err")
  _caddy_ok=0
  for _try in 1 2; do
    [[ $_try -gt 1 ]] && { info "Retrying in-cluster Caddy check after 15s (Caddy may have been starting)..."; sleep 15; }
    if "$SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh" 2>"$_caddy_err"; then
      _caddy_ok=1
      break
    fi
  done
  if [[ $_caddy_ok -eq 1 ]]; then
    ok "In-cluster Caddy strict TLS OK (cluster DNS path verified)"
  else
    warn "In-cluster Caddy check failed (Caddy may still be starting after registry push, or CA mismatch)."
    [[ -s "$_caddy_err" ]] && sed 's/^/    /' < "$_caddy_err" | tail -15
    info "Re-run: $SCRIPT_DIR/verify-caddy-strict-tls-in-cluster.sh"
  fi
  rm -f "$_caddy_err"
else
  info "Skipped (SKIP_IN_CLUSTER_CURL=1 or verify script not found)"
fi

# 4b. In-cluster traffic TO the LoadBalancer IP (proves MetalLB is processing traffic — HTTP/1.1 and HTTP/2)
# This addresses the root issue: MetalLB forwards traffic to the service when clients hit the LB IP.
if [[ -n "$lb_ip" ]] && [[ "${SKIP_IN_CLUSTER_CURL:-0}" != "1" ]]; then
  say "4b. LoadBalancer IP traffic (in-cluster curl to LB IP — proves MetalLB forwards HTTP/1.1 and HTTP/2)"
  POD_LB="verify-lb-traffic-$$"
  _kb delete pod -n "$NS_ING" "$POD_LB" --ignore-not-found --request-timeout=5s 2>/dev/null || true
  sleep 1
  CURL_IMG="${CURL_IMAGE:-curlimages/curl:latest}"
  # Pod curls the LB IP (not cluster DNS); MetalLB must forward to Caddy
  cat <<PODEOF | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $POD_LB
  namespace: $NS_ING
  labels:
    app: verify-lb-traffic
spec:
  restartPolicy: Never
  containers:
  - name: curl
    image: $CURL_IMG
    env:
    - name: LB_IP
      value: "$lb_ip"
    command:
    - /bin/sh
    - -c
    - |
      set -e
      echo "Curling LB_IP=\$LB_IP ..."
      code1="000"
      out1=\$(curl -k -sS -w '%{http_code}' -o /tmp/b1 --max-time 10 -H "Host: off-campus-housing.local" "https://\$LB_IP/_caddy/healthz" 2>&1) || true
      code1=\$(echo "\$out1" | tail -1)
      echo "HTTP1: \$code1 (curl stderr: \$(echo "\$out1" | head -5))"
      code2="000"
      out2=\$(curl -k -sS -w '%{http_code}' -o /tmp/b2 --max-time 10 --http2 -H "Host: off-campus-housing.local" "https://\$LB_IP/_caddy/healthz" 2>&1) || true
      code2=\$(echo "\$out2" | tail -1)
      echo "HTTP2: \$code2 (curl stderr: \$(echo "\$out2" | head -5))"
      if [ "\$code1" = "200" ] && [ "\$code2" = "200" ]; then exit 0; fi
      exit 1
PODEOF
  _lb_ok=0
  for _i in $(seq 1 35); do
    _phase=$(_kb -n "$NS_ING" get pod "$POD_LB" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
    [[ "$_phase" == "Succeeded" ]] && _lb_ok=1 && break
    [[ "$_phase" == "Failed" ]] && break
    sleep 1
  done
  # Always capture logs before delete (pod may be Running or terminal)
  _lb_log=$(_kb -n "$NS_ING" logs "$POD_LB" -c curl --tail=80 2>&1 || true)
  [[ -z "$_lb_log" ]] && _lb_log=$(_kb -n "$NS_ING" logs "$POD_LB" --all-containers=true --tail=80 2>&1 || true)
  _kb delete pod -n "$NS_ING" "$POD_LB" --ignore-not-found 2>/dev/null || true
  if [[ $_lb_ok -eq 1 ]]; then
    ok "LoadBalancer is processing traffic (in-cluster curl to $lb_ip: HTTP/1.1 and HTTP/2 returned 200)"
  else
    _log_preview=$(echo "$_lb_log" | head -20)
    if [[ "$ctx" == *"k3d"* ]]; then
      info "In-cluster curl to LB IP $lb_ip did not get 200 (expected on k3d: pod network has no route to MetalLB pool; use cluster DNS from pods — see docs/K3D_METALLB_INGRESS_EGRESS.md)"
      [[ -n "$_log_preview" ]] && echo "  Pod log (diagnostic):" && echo "$_log_preview" | sed 's/^/    /'
      # Optional: retry with hostNetwork so we see if the node can reach the LB IP (same L2 as MetalLB)
      say "4b1. In-cluster LB IP from node (hostNetwork pod — checks if node has route to MetalLB)"
      POD_LB2="verify-lb-node-$$"
      _kb delete pod -n "$NS_ING" "$POD_LB2" --ignore-not-found --request-timeout=5s 2>/dev/null || true
      sleep 1
      cat <<PODEOF2 | _kb apply -f - 2>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: $POD_LB2
  namespace: $NS_ING
  labels:
    app: verify-lb-node
spec:
  hostNetwork: true
  restartPolicy: Never
  containers:
  - name: curl
    image: ${CURL_IMG:-curlimages/curl:latest}
    command:
    - /bin/sh
    - -c
    - |
      code=\$(curl -k -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 -H "Host: off-campus-housing.local" "https://$lb_ip/_caddy/healthz" 2>/dev/null) || code="000"
      echo "\$code"
PODEOF2
      _node_ok=0
      for _j in $(seq 1 20); do
        _phase2=$(_kb -n "$NS_ING" get pod "$POD_LB2" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
        [[ "$_phase2" == "Succeeded" ]] && _node_ok=1 && break
        [[ "$_phase2" == "Failed" ]] && break
        sleep 1
      done
      _node_log=$(_kb -n "$NS_ING" logs "$POD_LB2" -c curl --tail=5 2>/dev/null || true)
      _kb delete pod -n "$NS_ING" "$POD_LB2" --ignore-not-found 2>/dev/null || true
      if [[ "$_node_ok" -eq 1 ]] && echo "$_node_log" | grep -q "200"; then
        ok "LB IP $lb_ip reachable from node (hostNetwork pod); regular pods use cluster DNS (see docs/K3D_METALLB_INGRESS_EGRESS.md)"
      else
        info "LB IP not reachable from node either (hostNetwork curl: $_node_log); host path via socat is the way on k3d"
      fi
    else
      warn "In-cluster curl to LB IP $lb_ip did not get 200 (check pod network route to MetalLB pool; see docs/K3D_METALLB_INGRESS_EGRESS.md)"
      [[ -n "$_log_preview" ]] && echo "  Pod log:" && echo "$_log_preview" | sed 's/^/    /'
    fi
  fi
else
  say "4b. LoadBalancer IP traffic (in-cluster)"
  info "Skipped (no LB IP or SKIP_IN_CLUSTER_CURL=1)"
fi

# 5. Host reachability: LB IP first; try k3d host route so we use LB path; on Colima try no-sudo forward (127.0.0.1:8443)
host_reached_lb=""
host_reached_nodeport=""
host_curl_host=""
host_curl_port=""
caddy_nodeport="${CADDY_NODEPORT:-}"
if [[ -z "$caddy_nodeport" ]]; then
  caddy_nodeport=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}' 2>/dev/null | head -1 | awk '{print $1}')
  [[ -z "$caddy_nodeport" ]] && caddy_nodeport="30443"
fi
# Colima no-sudo path: 127.0.0.1:HOST_HTTPS_PORT (setup-lb-ip-host-access-no-sudo.sh)
[[ -f "${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}" ]] && source "${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}" 2>/dev/null || true
host_https_host="${HOST_HTTPS_HOST:-}"
host_https_port="${HOST_HTTPS_PORT:-}"

# Helper: curl to LB IP using off-campus-housing.local for TLS (cert SAN). Returns 200 or 000.
_curl_lb_health() {
  curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --resolve "off-campus-housing.local:443:${1}" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null || echo "000"
}
# Helper: curl to host path (either LB IP:443 or 127.0.0.1:HOST_HTTPS_PORT when no-sudo path is used)
_curl_host_path_health() {
  if [[ -n "$host_https_port" ]] && [[ -n "$host_https_host" ]]; then
    curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 --resolve "off-campus-housing.local:${host_https_port}:${host_https_host}" "https://off-campus-housing.local:${host_https_port}/_caddy/healthz" 2>/dev/null || echo "000"
  else
    [[ -z "$lb_ip" ]] && echo "000" && return
    _curl_lb_health "$lb_ip"
  fi
}

# Step 4c. Wait for Caddy to have ready endpoints so LB IP traffic has a backend (root cause: claiming LB reachable before Caddy is ready).
if [[ -n "$lb_ip" ]] && [[ "${SKIP_HOST_CURL:-0}" != "1" ]]; then
  say "4c. Caddy ready (endpoints) before host curl"
  _ep_wait=0
  _ep_max=60
  while [[ $_ep_wait -lt $_ep_max ]]; do
    _addrs=$(_kb -n "$NS_ING" get endpoints caddy-h3 -o jsonpath='{.subsets[0].addresses[*].ip}' 2>/dev/null || echo "")
    if [[ -n "$_addrs" ]]; then
      ok "Caddy has ready endpoints ($_addrs)"
      break
    fi
    [[ $((_ep_wait % 10)) -eq 0 ]] && [[ $_ep_wait -gt 0 ]] && info "  Waiting for Caddy endpoints... ${_ep_wait}s"
    sleep 2
    _ep_wait=$((_ep_wait + 2))
  done
  if [[ -z "$_addrs" ]]; then
    warn "Caddy still has no ready endpoints after ${_ep_max}s; host curl to LB IP may fail (connection refused)"
  fi
fi

# Step 5: Host reachability to LB IP (MetalLB only — no NodePort/socat fallback on Colima).
if [[ "${SKIP_HOST_CURL:-0}" != "1" ]]; then
  say "5. Host reachability to LB IP (MetalLB IP only — HTTP/2 and HTTP/3 via LB IP)"
  if [[ -n "$lb_ip" ]] || [[ -n "$host_https_port" ]]; then
    if [[ "$(_curl_lb_health "$lb_ip")" == "200" ]]; then
      ok "Host can reach Caddy via LB IP $lb_ip (HTTPS/TCP) — LoadBalancer path"
      host_reached_lb="1"
      host_curl_host="$lb_ip"
      host_curl_port="443"
    elif [[ -n "$host_https_port" ]] && [[ "$(_curl_host_path_health)" == "200" ]]; then
      ok "Host can reach Caddy via 127.0.0.1:$host_https_port (existing forward to VM)"
      host_reached_lb="1"
      host_curl_host="${host_https_host:-127.0.0.1}"
      host_curl_port="$host_https_port"
    elif [[ "$ctx" == *"colima"* ]]; then
      info "Colima: LB IP $lb_ip not reachable from host. Ensure METALLB_POOL is on VM network (e.g. 192.168.64.240-192.168.64.250). Run: METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/install-metallb-colima.sh or apply pool from infra/k8s/metallb/."
    fi
    if [[ -z "$host_reached_lb" ]]; then
      # k3d: try host route to MetalLB subnet first
      if [[ "$ctx" == *"k3d"* ]] && command -v docker >/dev/null 2>&1; then
        _cluster_name="${ctx#k3d-}"
        _net_id=$(docker network ls -q --filter "name=k3d-${_cluster_name}" 2>/dev/null | head -1)
        if [[ -n "$_net_id" ]]; then
          _gw=$(docker network inspect "$_net_id" -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || echo "")
          if [[ -n "$_gw" ]]; then
            _lb_base=$(echo "$lb_ip" | sed -E 's/([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.0/')
            _route_ok=0
            ( route add -net "$_lb_base/24" "$_gw" 2>/dev/null ) && _route_ok=1
            [[ $_route_ok -eq 0 ]] && ( sudo route add -net "$_lb_base" -netmask 255.255.255.0 "$_gw" 2>/dev/null ) && _route_ok=1
            if [[ $_route_ok -eq 1 ]]; then
              info "Added host route $_lb_base/24 via $_gw (k3d); retrying curl to LB IP..."
              sleep 1
              if [[ "$(_curl_lb_health "$lb_ip")" == "200" ]]; then
                ok "Host can reach Caddy via LB IP $lb_ip after route add"
                host_reached_lb="1"
                host_curl_host="$lb_ip"
                host_curl_port="443"
              fi
            fi
          fi
        fi
      fi
      # k3d only: optional socat so host can reach LB IP (MetalLB IP only on Colima — no socat there)
      if [[ -z "$host_reached_lb" ]] && [[ "$ctx" == *"k3d"* ]] && [[ "${SKIP_LB_IP_SETUP:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access.sh" ]]; then
        if ! command -v socat >/dev/null 2>&1; then
          warn "socat not found. Install: brew install socat — then LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh (k3d only; Colima uses MetalLB IP only)"
        else
          say "Setting up LB IP for host on k3d (alias + socat). You may be prompted for your password (sudo). Please complete within 60s."
          info "Running: LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
          if LB_IP="$lb_ip" NODEPORT="$caddy_nodeport" "$SCRIPT_DIR/setup-lb-ip-host-access.sh"; then
            info "Settle 3s, then retrying host curl (up to 5 attempts)..."
            sleep 3
            for _retry in 1 2 3 4 5; do
              if [[ "$(_curl_lb_health "$lb_ip")" == "200" ]]; then
                host_reached_lb="1"
                host_curl_host="$lb_ip"
                host_curl_port="443"
                break
              fi
              [[ $_retry -lt 5 ]] && sleep 3
            done
            if [[ -n "$host_reached_lb" ]]; then
              ok "Host can reach Caddy via LB IP $lb_ip — socat applied (HTTP/1.1, HTTP/2, HTTP/3 via LB IP)"
            else
              warn "After socat, curl to LB IP $lb_ip still failed; check Caddy and NodePort $caddy_nodeport"
            fi
          else
            warn "setup-lb-ip-host-access.sh failed; run manually: LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
          fi
        fi
      fi
      if [[ -z "$host_reached_lb" ]]; then
        if [[ "$ctx" == *"colima"* ]]; then
          warn "Host cannot reach LB IP $lb_ip. MetalLB-only: ensure METALLB_POOL is on Colima VM network (e.g. 192.168.64.240-192.168.64.250). Run: METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/install-metallb-colima.sh"
        elif [[ "$ctx" == *"k3d"* ]]; then
          if [[ "${SKIP_LB_IP_SETUP:-0}" == "1" ]]; then
            info "LB IP setup skipped (SKIP_LB_IP_SETUP=1). Run: LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh (k3d only)"
          else
            warn "Host cannot reach LB IP $lb_ip. On k3d run: LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
          fi
        else
          info "Host cannot reach LB IP $lb_ip; ensure METALLB_POOL is on cluster network so LB IP is routable"
        fi
      fi
    fi
  else
    warn "No LoadBalancer IP; verification requires LB IP (no NodePort fallback)"
  fi
else
  say "5. Host reachability to LB IP"
  info "Skipped (SKIP_HOST_CURL=1)"
fi

# 5b. On k3d with LB IP reachable: ensure socat is running so HTTP/3 (UDP 443) works via LB IP.
# TCP may work via route add, but UDP 443 typically does not — socat must forward both TCP and UDP to NodePort.
if [[ "${SKIP_HOST_CURL:-0}" != "1" ]] && [[ -n "$host_reached_lb" ]] && [[ -n "$lb_ip" ]] && [[ "$ctx" == *"k3d"* ]] && [[ "${SKIP_LB_IP_SETUP:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access.sh" ]]; then
  if command -v socat >/dev/null 2>&1; then
    info "Ensuring socat (TCP+UDP 443 -> NodePort) for LB IP $lb_ip so HTTP/3 works via LB IP…"
    if LB_IP="$lb_ip" NODEPORT="$caddy_nodeport" "$SCRIPT_DIR/setup-lb-ip-host-access.sh"; then
      sleep 2
      ok "Socat ensured — HTTP/1.1, HTTP/2, HTTP/3 will use LB IP $lb_ip"
    else
      warn "setup-lb-ip-host-access.sh failed; HTTP/3 may fail (UDP 443 not forwarded)"
    fi
  else
    warn "socat not found (brew install socat); HTTP/3 to LB IP will fail without UDP 443 forward"
  fi
fi

# 6. HTTP/3 (QUIC) via LB IP — use --http3-only so we verify real QUIC (no HTTP/2 fallback; baseline uses --http3-only).
# NGTCP2_ENABLE_GSO=0 avoids sendmsg errno 5 (EIO) on macOS for QUIC.
# Colima: authoritative check is in-VM curl to LB IP (no host forwarder race). k3d: host path only.
export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"
if [[ "${SKIP_HOST_CURL:-0}" != "1" ]]; then
  say "6. HTTP/3 (QUIC) via LB IP (--http3-only)"
  _http3_lb_ok=""
  _http3_np_ok=""
  CA_CERT=""
  K8S_CA=$(_kb -n "$NS_ING" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  [[ -n "$K8S_CA" ]] && CA_CERT=$(mktemp 2>/dev/null) && echo "$K8S_CA" > "$CA_CERT"
  if [[ -n "$host_reached_lb" ]] && { [[ -n "$lb_ip" ]] || [[ -n "$host_curl_host" ]]; }; then
    _h3_host="${host_curl_host:-$lb_ip}"
    _h3_port="${host_curl_port:-443}"
    _h3_resolve="off-campus-housing.local:${_h3_port}:${_h3_host}"
    _h3_url="https://off-campus-housing.local:${_h3_port}/_caddy/healthz"
    [[ "$_h3_port" == "443" ]] && _h3_url="https://off-campus-housing.local/_caddy/healthz"
    _h3_args=()
    # No-sudo path (127.0.0.1:8443): use -k to match setup-lb-ip-host-access-no-sudo.sh quick verify (avoids CA/temp-file quirks).
    if [[ "$_h3_port" != "443" ]]; then
      _h3_args=(-k)
    else
      [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]] && _h3_args=(--cacert "$CA_CERT") || _h3_args=(-k)
    fi
    # Colima: try in-cluster hostNetwork pod with HTTP/3 first (authoritative: pod and Caddy are on same VM/L2). Image may need to pull.
    _http3_ok_printed=""
    if [[ "$ctx" == *"colima"* ]] && [[ -n "$lb_ip" ]] && kubectl get ns "$NS_ING" &>/dev/null; then
      _h3_img="${HTTP3_CURL_IMAGE:-rmarx/curl-http3:latest}"
      info "Colima: running in-cluster HTTP/3 check (hostNetwork pod → $lb_ip); may take a moment if image pulls..."
      _pod_h3_out=$(kubectl -n "$NS_ING" run "verify-h3-lb-$$" --rm -i --restart=Never --request-timeout=60s --quiet \
        --overrides='{"spec":{"hostNetwork":true}}' \
        --image="$_h3_img" -- \
        curl -k -sS -o /dev/null -w "%{http_code}\n" --connect-timeout 8 --max-time 20 --http3 "https://${lb_ip}/_caddy/healthz" 2>/dev/null || echo "000")
      _pod_h3_code=$(echo "$_pod_h3_out" | head -1 | tr -d '\r\n')
      [[ ! "$_pod_h3_code" =~ ^[0-9]{3}$ ]] && _pod_h3_code="000"
      _pod_h3_code=$(_normalize_http_code "$_pod_h3_code")
      if [[ "$_pod_h3_code" == "200" ]]; then
        _http3_lb_ok=1
        _http3_ok_printed=1
        ok "HTTP/3 (QUIC) via LB IP $lb_ip verified in-cluster (hostNetwork pod). MetalLB + QUIC correct."
      else
        [[ "$_pod_h3_code" != "000" ]] && info "In-cluster HTTP/3 returned $_pod_h3_code."
        echo "$_pod_h3_out" | grep -iE 'error|failed|pull|image' | head -3 | sed 's/^/  /' || true
      fi
    fi
    # Colima fallback: in-VM curl (if in-cluster pod failed or image pull issue).
    if [[ "$_http3_lb_ok" != "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ -n "$lb_ip" ]] && command -v colima &>/dev/null 2>&1; then
      _vm_h3=$(colima ssh -- curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 --http3-only "https://${lb_ip}/_caddy/healthz" 2>/dev/null || echo "000")
      _vm_h3=$(_normalize_http_code "$_vm_h3")
      if [[ "$_vm_h3" == "200" ]]; then
        _http3_lb_ok=1
        _http3_ok_printed=1
        ok "HTTP/3 (QUIC) via LB IP $lb_ip verified in-VM (--http3-only). MetalLB + QUIC correct; host forwarder not used."
      else
        info "In-VM HTTP/3 to $lb_ip returned $_vm_h3 (VM curl may lack --http3-only). Will try host path next."
      fi
    fi
    # Colima fallback: when in-VM returned 000 (VM curl no HTTP/3) but no-sudo forward is up (127.0.0.1:8443), try host HTTP/3 so we pass when the forward works.
    if [[ "$_http3_lb_ok" != "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ "$_h3_port" == "8443" ]] && [[ "$(uname -s)" == "Darwin" ]] && [[ -x "$CURL_BIN" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
      export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"
      _colima_h3=$(_normalize_http_code "$("$CURL_BIN" --http3-only -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 --resolve "off-campus-housing.local:8443:127.0.0.1" "https://off-campus-housing.local:8443/_caddy/healthz" 2>/dev/null || echo "000")")
      [[ "$_colima_h3" == "200" ]] && _http3_lb_ok=1
      [[ "$_http3_lb_ok" == "1" ]] && ok "HTTP/3 (QUIC) via 127.0.0.1:8443 (no-sudo forward) verified — QUIC working."
    fi
    # k3d only: host path (no-sudo 127.0.0.1:8443 or LB IP:443). On Colima we already tried 127.0.0.1:8443 above when in-VM failed.
    if [[ "$_http3_lb_ok" != "1" ]] && [[ "$_h3_port" != "443" ]] && [[ "$ctx" != *"colima"* ]]; then
      sleep 1
      _tcp_8443=$(lsof -i TCP:8443 -t 2>/dev/null | head -1 || true)
      _udp_8443=$(lsof -i UDP:8443 -t 2>/dev/null | head -1 || true)
      if [[ -z "$_tcp_8443" ]] || [[ -z "$_udp_8443" ]]; then
        info "UDP or TCP 8443 not bound. Restarting no-sudo forward for HTTP/3..."
        [[ -f "$SCRIPT_DIR/setup-lb-ip-host-access-no-sudo.sh" ]] && "$SCRIPT_DIR/setup-lb-ip-host-access-no-sudo.sh" 2>/dev/null || true
        sleep 1
      fi
      export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"
      _h3_exact_code="000"
      if [[ "$(uname -s)" == "Darwin" ]] && [[ -x "$CURL_BIN" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
        _h3_exact_code=$("$CURL_BIN" --http3-only -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
            --resolve "off-campus-housing.local:${_h3_port}:127.0.0.1" "https://off-campus-housing.local:${_h3_port}/_caddy/healthz" 2>/dev/null || echo "000")
        _h3_exact_code=$(_normalize_http_code "$_h3_exact_code")
        [[ "$_h3_exact_code" == "200" ]] && _http3_lb_ok=1
      fi
      if [[ "$_http3_lb_ok" != "1" ]]; then
        info "Retrying HTTP/3 via 127.0.0.1:${_h3_port} in 2s..."
        sleep 2
        _h3_exact_code=$("$CURL_BIN" --http3-only -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
            --resolve "off-campus-housing.local:${_h3_port}:127.0.0.1" "https://off-campus-housing.local:${_h3_port}/_caddy/healthz" 2>/dev/null || echo "000")
        _h3_exact_code=$(_normalize_http_code "$_h3_exact_code")
        [[ "$_h3_exact_code" == "200" ]] && _http3_lb_ok=1
      fi
    fi
    # LB IP direct (port 443): host can reach LB IP (bridged Colima or k3d). Skip on Colima when we already did in-VM-only.
    if [[ "$_http3_lb_ok" != "1" ]] && [[ "$_h3_port" == "443" ]]; then
      if [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
        _code=$(_normalize_http_code "$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
            --resolve "$_h3_resolve" "${_h3_args[@]}" "$_h3_url" 2>/dev/null || echo "000")")
        [[ "$_code" == "200" ]] && _http3_lb_ok=1
      fi
    fi
    # Skip http3_curl/docker fallback on Colima when not bridged (no 127.0.0.1/socat path).
    if [[ "$_http3_lb_ok" != "1" ]] && [[ -f "${SCRIPT_DIR}/lib/http3.sh" ]] && { [[ "$ctx" != *"colima"* ]] || [[ "$_h3_port" == "443" ]]; }; then
      source "${SCRIPT_DIR}/lib/http3.sh"
      if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
        args_ca=(--cacert "$CA_CERT")
      else
        args_ca=(-k)
      fi
      if [[ "$(uname -s)" == "Darwin" ]]; then
        _docker_ip=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || echo "")
        _docker_port="18443"
        [[ -f "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" ]] && _docker_port=$(cat "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" 2>/dev/null || echo "18443")
        [[ -n "$_docker_ip" ]] && _h3_resolve="off-campus-housing.local:${_docker_port}:$_docker_ip" && _h3_url="https://off-campus-housing.local:${_docker_port}/_caddy/healthz"
      fi
      if http3_curl --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 12 \
          --resolve "$_h3_resolve" "${args_ca[@]}" "$_h3_url" 2>/dev/null | grep -q 200; then
        _http3_lb_ok=1
      fi
    fi
    # Stable mode: HTTP/3 must pass within 15s (5 attempts, 3s apart). Single 000 is not a failure until retries exhausted.
    if [[ "$_http3_lb_ok" != "1" ]] && [[ "$VERIFY_MODE" == "stable" ]]; then
      info "Stable mode: retrying HTTP/3 up to 5 times (3s apart) from host..."
      for _r in 1 2 3 4 5; do
        _code_retry="000"
        if [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
          _code_retry=$(_normalize_http_code "$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
              --resolve "$_h3_resolve" "${_h3_args[@]}" "$_h3_url" 2>/dev/null || echo "000")")
        fi
        [[ "$_code_retry" == "200" ]] && _http3_lb_ok=1 && break
        [[ $_r -lt 5 ]] && sleep 3
      done
      # Colima: host often cannot reach VM network over UDP 443. Authoritative check is in-cluster (hostNetwork pod → LB IP).
      if [[ "$_http3_lb_ok" != "1" ]] && [[ "$ctx" == *"colima"* ]] && [[ -n "$lb_ip" ]] && kubectl get ns "$NS_ING" &>/dev/null; then
        info "Colima: host QUIC to LB IP failed; trying in-cluster hostNetwork pod (authoritative for MetalLB + QUIC)..."
        _h3_img="${HTTP3_CURL_IMAGE:-rmarx/curl-http3:latest}"
        _pod_out=$(kubectl -n "$NS_ING" run "verify-h3-stable-$$" --rm -i --restart=Never --request-timeout=30s --quiet \
          --overrides='{"spec":{"hostNetwork":true}}' \
          --image="$_h3_img" -- \
          curl -k -sS -o /dev/null -w "%{http_code}\n" --connect-timeout 8 --max-time 20 --http3 "https://${lb_ip}/_caddy/healthz" 2>/dev/null || echo "000")
        _pod_code=$(echo "$_pod_out" | head -1 | tr -d '\r\n')
        [[ ! "$_pod_code" =~ ^[0-9]{3}$ ]] && _pod_code="000"
        _pod_code=$(_normalize_http_code "$_pod_code")
        if [[ "$_pod_code" == "200" ]]; then
          _http3_lb_ok=1
          ok "HTTP/3 (QUIC) via LB IP $lb_ip verified in-cluster (hostNetwork pod). MetalLB + Caddy QUIC OK; host→VM UDP may be blocked."
        else
          info "In-cluster HTTP/3 to $lb_ip returned $_pod_code (first line of output only; no parsing of pod names)."
        fi
      fi
      if [[ "$_http3_lb_ok" != "1" ]]; then
        echo ""
        info "Diagnostic: On Colima, UDP 443 from Mac to VM network (192.168.64.x) often does not work. In-cluster QUIC to LB IP is the authoritative check."
        info "Manual in-cluster check: kubectl -n $NS_ING run verify-h3-manual --rm -i --restart=Never --image=rmarx/curl-http3:latest --overrides='{\"spec\":{\"hostNetwork\":true}}' -- curl -k -v --http3 https://$lb_ip/_caddy/healthz"
        fail "HTTP/3 did not pass within 15s (stable mode). QUIC must succeed from host or in-cluster; check UDP 443 and Caddy."
      fi
    fi
    if [[ "$_http3_lb_ok" == "1" ]]; then
      [[ -z "${_http3_ok_printed:-}" ]] && ok "HTTP/3 (QUIC) via $_h3_host:$_h3_port verified (--http3-only)"
    else
      [[ "$VERIFY_MODE" != "chaos" ]] && warn "HTTP/3 (--http3-only) via $_h3_host:$_h3_port failed — QUIC not working. See step 6b and root cause below."
      [[ "$VERIFY_MODE" == "chaos" ]] && info "HTTP/3 not yet 200 (chaos mode; recovery checked in 6a post-chaos)."
    fi
  else
    info "Skipped (LB IP not reachable; step 5 requires LB IP)"
  fi
  # 6b. HTTP/3 (QUIC) via NodePort — k3d: host has NodePort on 127.0.0.1. Colima: NodePort is on VM only (127.0.0.1:NODEPORT is wrong).
  say "6b. HTTP/3 (QUIC) via NodePort (--http3-only)"
  if [[ "$ctx" == *"colima"* ]]; then
    # On Colima, NodePort is on the VM (e.g. 192.168.64.7:31839), not on the Mac. Do not curl 127.0.0.1:NODEPORT from host.
    if [[ "$_http3_lb_ok" == "1" ]]; then
      ok "On Colima, NodePort is on VM (not host). QUIC already verified via LB IP (in-VM or bridged host)."
      _http3_np_ok=1
    else
      info "On Colima, NodePort is on VM; 127.0.0.1:$caddy_nodeport is not valid from Mac. Verify QUIC in-VM: colima ssh -- curl -k --http3-only https://$lb_ip/_caddy/healthz"
    fi
  elif [[ -n "$host_curl_port" ]] && [[ "$host_curl_port" != "443" ]] && [[ "$_http3_lb_ok" == "1" ]]; then
    ok "HTTP/3 via NodePort (via 127.0.0.1:$host_curl_port forward to VM:$caddy_nodeport) already verified in step 6"
    _http3_np_ok=1
  fi
  # k3d only: NodePort is published to host 127.0.0.1. On Colima we already handled 6b above (NodePort is on VM).
  if [[ "$_http3_np_ok" != "1" ]] && [[ "$ctx" != *"colima"* ]]; then
    if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
      _np_args=(--cacert "$CA_CERT")
    else
      _np_args=(-k)
    fi
    if [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
      _np_code=$(_normalize_http_code "$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
          --resolve "off-campus-housing.local:${caddy_nodeport}:127.0.0.1" "${_np_args[@]}" "https://off-campus-housing.local:${caddy_nodeport}/_caddy/healthz" 2>/dev/null || echo "000")")
      [[ "$_np_code" == "200" ]] && _http3_np_ok=1
    fi
  fi
  if [[ "$_http3_np_ok" != "1" ]] && [[ "$ctx" != *"colima"* ]] && [[ -f "${SCRIPT_DIR}/lib/http3.sh" ]]; then
    source "${SCRIPT_DIR}/lib/http3.sh" 2>/dev/null || true
    _np_code=$(_normalize_http_code "$(http3_curl --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 12 \
        --resolve "off-campus-housing.local:${caddy_nodeport}:127.0.0.1" "${_np_args[@]}" "https://off-campus-housing.local:${caddy_nodeport}/_caddy/healthz" 2>/dev/null || echo "000")")
    [[ "$_np_code" == "200" ]] && _http3_np_ok=1
  fi
  if [[ "$_http3_np_ok" == "1" ]]; then
    [[ "$ctx" != *"colima"* ]] && ok "HTTP/3 (QUIC) via NodePort 127.0.0.1:$caddy_nodeport verified (--http3-only)"
    # NodePort works but LB IP failed — retry setup with sudo once (binding 443 often needs sudo)
    if [[ "$_http3_lb_ok" != "1" ]] && [[ -n "${lb_ip:-}" ]] && [[ "$ctx" == *"k3d"* ]] && [[ "${SKIP_LB_IP_SETUP:-0}" != "1" ]] && command -v socat >/dev/null 2>&1; then
      info "Retrying setup with sudo so UDP 443 is bound for LB IP…"
      if sudo LB_IP="$lb_ip" NODEPORT="$caddy_nodeport" "$SCRIPT_DIR/setup-lb-ip-host-access.sh" 2>/dev/null; then
        sleep 3
        _code_retry=$(_normalize_http_code "$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 12 \
            --resolve "off-campus-housing.local:443:$lb_ip" "${_h3_args[@]}" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null || echo "000")")
        [[ "$_code_retry" == "200" ]] && _http3_lb_ok=1
        [[ "$_http3_lb_ok" == "1" ]] && ok "HTTP/3 via LB IP $lb_ip OK after sudo setup retry"
      fi
      [[ "$_http3_lb_ok" != "1" ]] && info "For HTTP/3 via LB IP run once (sudo): LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
    elif [[ "$_http3_lb_ok" != "1" ]] && [[ -n "${lb_ip:-}" ]]; then
      info "For HTTP/3 via LB IP run once (sudo): LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
    fi
  elif [[ "$ctx" != *"colima"* ]]; then
    warn "HTTP/3 (--http3-only) via NodePort 127.0.0.1:$caddy_nodeport failed"
  fi
  # Root cause when both fail
  if [[ "$_http3_lb_ok" != "1" ]] && [[ "$_http3_np_ok" != "1" ]]; then
    say "Root cause: HTTP/3 (QUIC) requires UDP. Both LB IP and NodePort paths failed or N/A."
    if [[ "$ctx" == *"colima"* ]]; then
      info "  Colima: QUIC is validated only in-VM. Run: colima ssh -- curl -k --http3-only https://$lb_ip/_caddy/healthz"
      info "  If VM curl lacks --http3-only, install curl+ngtcp2 in the VM, or use bridged so Mac can hit LB IP directly (recommended): ./scripts/colima-start-k3s-bridged-clean.sh  then from Mac: curl -k --http3-only https://$lb_ip/_caddy/healthz"
    elif [[ "$ctx" == *"k3d"* ]] && [[ -f "$SCRIPT_DIR/verify-k3d-30443-udp.sh" ]]; then
      info "Checking k3d port bindings (TCP + UDP 30443)..."
      "$SCRIPT_DIR/verify-k3d-30443-udp.sh" 2>&1 | sed 's/^/  /' || true
    else
      info "  k3d must publish UDP 30443 to the host. Recreate cluster: ./scripts/k3d-create-2-node-cluster.sh (includes --port 30443:30443/udp@server:0)."
      info "  Then run: LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh (sudo) so LB IP path works."
    fi
    info "  See docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md for full root cause and rebuild checklist."
  fi
  # When verify fails and host path was 127.0.0.1:8443 (no-sudo forward): lsof + manual curl diagnostic
  if [[ "$_http3_lb_ok" != "1" ]] && [[ "${host_curl_port:-}" == "8443" ]]; then
    say "HTTP/3 failed (127.0.0.1:8443 path) — run these after verify fails:"
    info "  1. lsof -i UDP:8443"
    info "     If nothing is listening → socat died. Restart: ./scripts/setup-lb-ip-host-access-no-sudo.sh"
    info "     If something is listening but HTTP/3 still fails → UDP socket is stale; restart the forwarder."
    info "  2. Manual test (HTTP/3 via no-sudo forward):"
    _curl_path="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
    info "     NGTCP2_ENABLE_GSO=0 $_curl_path --http3-only -k -v --resolve off-campus-housing.local:8443:127.0.0.1 https://off-campus-housing.local:8443/_caddy/healthz"
    info "  Prefer bridged (no socat): ./scripts/colima-start-k3s-bridged-clean.sh  then: curl --http3-only https://<LB_IP>/_caddy/healthz"
  fi
  # 6c. Diagnose when NodePort HTTP/3 works but LB IP HTTP/3 fails — UDP 443 on LB IP path is broken
  if [[ "$_http3_lb_ok" != "1" ]] && [[ "$_http3_np_ok" == "1" ]] && [[ -n "${lb_ip:-}" ]]; then
    say "6c. Diagnose HTTP/3 via LB IP (NodePort OK; LB IP failed — UDP 443 on $lb_ip)"
    _udp_pid_file="/tmp/lb-ip-forward-$(echo "$lb_ip" | tr '.' '_')-udp.pid"
    _udp_listening=""
    if command -v lsof >/dev/null 2>&1; then
      _udp_listening=$(lsof -i UDP:443 -P -n 2>/dev/null | head -20 || true)
      [[ -z "$_udp_listening" ]] && _udp_listening=$(sudo lsof -i UDP:443 -P -n 2>/dev/null | head -20 || true)
    fi
    if [[ -f "$_udp_pid_file" ]]; then
      _pid=$(cat "$_udp_pid_file" 2>/dev/null)
      if [[ -n "$_pid" ]] && ps -p "$_pid" -o pid= 2>/dev/null | grep -q .; then
        info "  UDP forwarder process running (PID $_pid): $(ps -p "$_pid" -o comm= 2>/dev/null || echo '?')"
      else
        warn "  UDP PID file $_udp_pid_file has PID $_pid but process not running (stale). Run: sudo LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
      fi
    else
      warn "  No UDP forwarder PID file ($_udp_pid_file). Run: sudo LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
    fi
    if [[ -n "$_udp_listening" ]]; then
      # Show only listeners (LISTEN) or sockets bound to LB IP; lsof -i UDP:443 also shows outbound (e.g. Chrome->remote:443) which is confusing
      _udp_listeners_only=$(echo "$_udp_listening" | grep -E "LISTEN|$lb_ip" || true)
      if [[ -n "$_udp_listeners_only" ]]; then
        info "  UDP 443 listeners on $lb_ip or *:443 (lsof):"
        echo "$_udp_listeners_only" | sed 's/^/    /'
      else
        info "  UDP 443 lsof (all; may include outbound Chrome etc.):"
        echo "$_udp_listening" | sed 's/^/    /'
        info "  No socket bound to $lb_ip:443 — socat may not be listening on LB IP. Restart: sudo LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
      fi
      if [[ -f "$_udp_pid_file" ]] && [[ -n "$_pid" ]]; then
        _fd_udp=$(sudo lsof -p "$_pid" -i UDP -P -n 2>/dev/null | grep -E "443|$lb_ip" || true)
        [[ -n "$_fd_udp" ]] && info "  Forwarder PID $_pid UDP fds:" && echo "$_fd_udp" | sed 's/^/    /'
      fi
    else
      warn "  No process listening on UDP 443 (lsof). Start UDP forwarder: sudo LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh"
      info "  If setup was run, check: /tmp/lb-ip-socat-udp.log — and on macOS allow UDP 443 in firewall."
    fi
    if [[ -f "$SCRIPT_DIR/diagnose-http3-lb-ip-under-the-hood.sh" ]]; then
      info "  Under-the-hood (tcpdump on lo0 + socat log): LB_IP=$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/diagnose-http3-lb-ip-under-the-hood.sh"
    fi
  fi
  [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]] && rm -f "$CA_CERT"
else
  say "6. HTTP/3 (QUIC) via LB IP"
  info "Skipped (SKIP_HOST_CURL=1)"
fi

# 6a. All three protocols via LB IP — stable mode only. No chaos in this path. HTTP/3 must pass within 15s retry.
if [[ "${SKIP_HOST_CURL:-0}" == "1" ]]; then
  say "6a. All three protocols"
  info "Skipped (SKIP_HOST_CURL=1)"
elif [[ "$VERIFY_MODE" == "stable" ]]; then
  say "6a. All three protocols via LB IP (HTTP/1.1, HTTP/2, HTTP/3) [stable — no chaos]"
  if [[ -n "$host_reached_lb" ]] && { [[ -n "$lb_ip" ]] || [[ -n "$host_curl_host" ]]; }; then
    _host_6a="${host_curl_host:-$lb_ip}"
    _port_6a="${host_curl_port:-443}"
    _url="https://off-campus-housing.local/_caddy/healthz"
    [[ "$_port_6a" != "443" ]] && _url="https://off-campus-housing.local:${_port_6a}/_caddy/healthz"
    _resolve_6a=(--resolve "off-campus-housing.local:${_port_6a}:${_host_6a}")
    _url_h3="$_url"
    if [[ "$(uname -s)" == "Darwin" ]] && [[ "$_port_6a" == "443" ]]; then
      _docker_ip_6a=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || echo "")
      _docker_port_6a="18443"
      [[ -f "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" ]] && _docker_port_6a=$(cat "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" 2>/dev/null || echo "18443")
      [[ -n "$_docker_ip_6a" ]] && _resolve_6a=(--resolve "off-campus-housing.local:${_docker_port_6a}:$_docker_ip_6a") && _url_h3="https://off-campus-housing.local:${_docker_port_6a}/_caddy/healthz"
    fi
    _h1=""
    _h2=""
    _h3=""
    _ca_6a=(-k)
    if [[ "$_port_6a" == "443" ]] && [[ -n "${K8S_CA:-}" ]]; then
      _ca_file_6a=$(mktemp 2>/dev/null) && echo "$K8S_CA" > "$_ca_file_6a" && _ca_6a=(--cacert "$_ca_file_6a")
    fi
    _code=$(_normalize_http_code "$(curl -k -sS -o /dev/null -w "%{http_code}" --http1.1 --connect-timeout 3 --max-time 5 --resolve "off-campus-housing.local:${_port_6a}:${_host_6a}" "$_url" 2>/dev/null || echo "000")")
    [[ "$_code" == "200" ]] && _h1="200" || _h1="failed ($_code)"
    _code=$(_normalize_http_code "$(curl -k -sS -o /dev/null -w "%{http_code}" --http2 --connect-timeout 3 --max-time 5 --resolve "off-campus-housing.local:${_port_6a}:${_host_6a}" "$_url" 2>/dev/null || echo "000")")
    [[ "$_code" == "200" ]] && _h2="200" || _h2="failed ($_code)"
    # HTTP/3: On Colima, in-cluster (step 6) is authoritative; host curl often lacks --http3-only. Reuse step 6 result.
    _h3_code="000"
    if [[ "$ctx" == *"colima"* ]] && [[ "${_http3_lb_ok:-0}" == "1" ]]; then
      _h3_code="200"
      _h3="200"
      info "HTTP/3: reusing in-cluster result from step 6 (host curl not required for QUIC on Colima)."
    else
      # HTTP/3: 15s retry (5 attempts, 3s apart). Stable mode must pass when not Colima or step 6 did not pass.
      for _a in 1 2 3 4 5; do
        if [[ "$(uname -s)" == "Darwin" ]] && [[ -x "$CURL_BIN" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
          _h3_code=$(_normalize_http_code "$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
              --resolve "off-campus-housing.local:${_port_6a}:${_host_6a}" "${_ca_6a[@]}" "$_url" 2>/dev/null || echo "000")")
        fi
        if [[ "$_h3_code" != "200" ]] && [[ "$(uname -s)" != "Darwin" ]] && [[ -f "${SCRIPT_DIR}/lib/http3.sh" ]]; then
          source "${SCRIPT_DIR}/lib/http3.sh" 2>/dev/null || true
          _h3_code=$(_normalize_http_code "$(http3_curl --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 12 "${_resolve_6a[@]}" "${_ca_6a[@]}" "$_url_h3" 2>/dev/null || echo "000")")
        fi
        [[ "$_h3_code" == "200" ]] && break
        [[ $_a -lt 5 ]] && sleep 3
      done
      [[ "$_h3_code" == "200" ]] && _h3="200" || _h3="failed ($_h3_code)"
    fi
    [[ -n "${_ca_file_6a:-}" ]] && [[ -f "$_ca_file_6a" ]] && rm -f "$_ca_file_6a"
    echo "  HTTP/1.1: $_h1"
    echo "  HTTP/2:   $_h2"
    echo "  HTTP/3:   $_h3"
    if [[ "$_h1" == "200" ]] && [[ "$_h2" == "200" ]] && [[ "$_h3" == "200" ]]; then
      ok "All three protocols working via $_host_6a:$_port_6a (HTTP/1.1, HTTP/2, HTTP/3)"
    elif [[ "$_h3" != "200" ]]; then
      fail "Stable mode: HTTP/3 must pass within 15s retry. QUIC must succeed; check UDP 443 and Caddy."
    else
      warn "HTTP/1.1: $_h1, HTTP/2: $_h2, HTTP/3: $_h3"
    fi
  else
    info "Skipped (LB IP not reachable; step 5 requires LB IP)"
  fi
else
  info "6a skipped in chaos mode (runs after advanced as 6a post-chaos with 30s recovery)"
fi

# Write reachable target early so run-all-test-suites has it even if advanced section hangs or fails
METALLB_ENV_EARLY="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
rm -f "$METALLB_ENV_EARLY"
if [[ -n "$host_reached_lb" ]] && [[ -n "$lb_ip" ]]; then
  echo "USE_LB_FOR_TESTS=1" >> "$METALLB_ENV_EARLY"
  echo "REACHABLE_LB_IP=$lb_ip" >> "$METALLB_ENV_EARLY"
  echo "PORT=443" >> "$METALLB_ENV_EARLY"
  echo "HTTP3_LB_IP_OK=${_http3_lb_ok:-0}" >> "$METALLB_ENV_EARLY"
  echo "HTTP3_NODEPORT_OK=${_http3_np_ok:-0}" >> "$METALLB_ENV_EARLY"
fi

# Chaos only: MetalLB advanced (BGP, route flaps, ARP sim, speaker restart, multi-subnet). Not run in stable mode.
if [[ "$VERIFY_MODE" == "chaos" ]] && [[ -f "$SCRIPT_DIR/verify-metallb-advanced.sh" ]]; then
  say "Chaos: MetalLB advanced (speaker restart, ARP, route flaps, multi-pool)"
  LB_IP="${lb_ip:-}" bash "$SCRIPT_DIR/verify-metallb-advanced.sh" 2>&1 || warn "MetalLB advanced had issues; continuing to 6a post-chaos"
fi

# 6a post-chaos (chaos mode only): all three protocols after disruptive actions. HTTP/3 may have flapped; must recover within 30s (10 attempts, 3s apart).
if [[ "$VERIFY_MODE" == "chaos" ]] && [[ "${SKIP_HOST_CURL:-0}" != "1" ]] && [[ -n "$host_reached_lb" ]] && { [[ -n "$lb_ip" ]] || [[ -n "$host_curl_host" ]]; }; then
  say "6a. All three protocols via LB IP (post-chaos — HTTP/3 must recover within 30s)"
  _host_6a="${host_curl_host:-$lb_ip}"
  _port_6a="${host_curl_port:-443}"
  _url="https://off-campus-housing.local/_caddy/healthz"
  [[ "$_port_6a" != "443" ]] && _url="https://off-campus-housing.local:${_port_6a}/_caddy/healthz"
  _resolve_6a=(--resolve "off-campus-housing.local:${_port_6a}:${_host_6a}")
  _url_h3="$_url"
  if [[ "$(uname -s)" == "Darwin" ]] && [[ "$_port_6a" == "443" ]]; then
    _docker_ip_6a=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' || echo "")
    _docker_port_6a="18443"
    [[ -f "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" ]] && _docker_port_6a=$(cat "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" 2>/dev/null || echo "18443")
    [[ -n "$_docker_ip_6a" ]] && _resolve_6a=(--resolve "off-campus-housing.local:${_docker_port_6a}:$_docker_ip_6a") && _url_h3="https://off-campus-housing.local:${_docker_port_6a}/_caddy/healthz"
  fi
  _ca_6a=(-k)
  if [[ "$_port_6a" == "443" ]] && [[ -n "${K8S_CA:-}" ]]; then
    _ca_file_6a=$(mktemp 2>/dev/null) && echo "$K8S_CA" > "$_ca_file_6a" && _ca_6a=(--cacert "$_ca_file_6a")
  fi
  _code=$(_normalize_http_code "$(curl -k -sS -o /dev/null -w "%{http_code}" --http1.1 --connect-timeout 3 --max-time 5 --resolve "off-campus-housing.local:${_port_6a}:${_host_6a}" "$_url" 2>/dev/null || echo "000")")
  [[ "$_code" == "200" ]] && _h1="200" || _h1="failed ($_code)"
  _code=$(_normalize_http_code "$(curl -k -sS -o /dev/null -w "%{http_code}" --http2 --connect-timeout 3 --max-time 5 --resolve "off-campus-housing.local:${_port_6a}:${_host_6a}" "$_url" 2>/dev/null || echo "000")")
  [[ "$_code" == "200" ]] && _h2="200" || _h2="failed ($_code)"
  _h3="failed (000)"
  _h3_code="000"
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [[ "$(uname -s)" == "Darwin" ]] && "$CURL_BIN" --help all 2>/dev/null | grep -q -- "--http3-only"; then
      _h3_code=$(_normalize_http_code "$(NGTCP2_ENABLE_GSO=0 "$CURL_BIN" --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 \
          --resolve "off-campus-housing.local:${_port_6a}:${_host_6a}" "${_ca_6a[@]}" "$_url" 2>/dev/null || echo "000")")
    fi
    if [[ "$_h3_code" != "200" ]] && [[ "$(uname -s)" != "Darwin" ]] && [[ -f "${SCRIPT_DIR}/lib/http3.sh" ]]; then
      source "${SCRIPT_DIR}/lib/http3.sh" 2>/dev/null || true
      _h3_code=$(_normalize_http_code "$(http3_curl --http3-only -sS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 12 "${_resolve_6a[@]}" "${_ca_6a[@]}" "$_url_h3" 2>/dev/null || echo "000")")
    fi
    if [[ "$_h3_code" == "200" ]]; then
      _h3="200"
      [[ $_attempt -gt 1 ]] && info "HTTP/3 recovered on attempt $_attempt (convergence)"
      break
    fi
    [[ $_attempt -lt 10 ]] && sleep 3
  done
  [[ "$_h3_code" != "200" ]] && _h3="failed ($_h3_code)"
  [[ -n "${_ca_file_6a:-}" ]] && [[ -f "$_ca_file_6a" ]] && rm -f "$_ca_file_6a"
  echo "  HTTP/1.1: $_h1"
  echo "  HTTP/2:   $_h2"
  echo "  HTTP/3:   $_h3"
  if [[ "$_h1" == "200" ]] && [[ "$_h2" == "200" ]] && [[ "$_h3" == "200" ]]; then
    ok "All three protocols working via $_host_6a:$_port_6a after chaos (HTTP/3 convergence OK)"
  elif [[ "$_h3" != "200" ]]; then
    fail "Chaos mode: HTTP/3 did not recover within 30s: $_h3. QUIC must recover after speaker/route churn."
  else
    warn "Post-chaos — HTTP/1.1: $_h1, HTTP/2: $_h2, HTTP/3: $_h3"
  fi
fi

say "=== MetalLB verification complete ==="
info "L2 mode; optional nodeSelector on L2Advertisement (see docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md)."
info "Stable (default): VERIFY_MODE=stable. Chaos: VERIFY_MODE=chaos $SCRIPT_DIR/verify-metallb-and-traffic-policy.sh"
# Write reachable target so run-all-test-suites / test-microservices can use LB IP when host reached it (key for MetalLB)
METALLB_ENV="${METALLB_REACHABLE_ENV:-/tmp/metallb-reachable.env}"
rm -f "$METALLB_ENV"
if [[ -n "$host_reached_lb" ]] && [[ -n "$lb_ip" ]]; then
  echo "USE_LB_FOR_TESTS=1" >> "$METALLB_ENV"
  echo "REACHABLE_LB_IP=$lb_ip" >> "$METALLB_ENV"
  echo "PORT=443" >> "$METALLB_ENV"
  echo "HTTP3_LB_IP_OK=${_http3_lb_ok:-0}" >> "$METALLB_ENV"
  echo "HTTP3_NODEPORT_OK=${_http3_np_ok:-0}" >> "$METALLB_ENV"
  # Docker-on-macOS: containers cannot reach host loopback (LB_IP). Docker bridge socat listens on 0.0.0.0:18443.
  # Resolve host.docker.internal so HTTP/3 curl (runs in Docker) can use it.
  if [[ "$(uname -s)" == "Darwin" ]] && command -v docker >/dev/null 2>&1; then
    _docker_port="18443"
    [[ -f "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" ]] && _docker_port=$(cat "${TMPDIR:-/tmp}/lb-ip-docker-forward-port-$(echo "$lb_ip" | tr '.' '_').txt" 2>/dev/null || echo "18443")
    _docker_host_ip=$(docker run --rm alpine getent hosts host.docker.internal 2>/dev/null | awk '{print $1}') || true
    [[ -z "${_docker_host_ip:-}" ]] && _docker_host_ip=""
    if [[ -n "$_docker_host_ip" ]]; then
      echo "DOCKER_FORWARD_PORT=$_docker_port" >> "$METALLB_ENV"
      echo "DOCKER_HOST_IP=$_docker_host_ip" >> "$METALLB_ENV"
    fi
  fi
  # Summary: only claim HTTP/3 when we actually verified it (in-VM or host path).
  if [[ "${_http3_lb_ok:-0}" == "1" ]]; then
    [[ -n "${_docker_host_ip:-}" ]] && info "Host reachability: LB IP $lb_ip — HTTP/1.1, HTTP/2, HTTP/3 verified. Docker bridge ${_docker_host_ip}:${_docker_port:-18443} for HTTP/3 from containers."
    [[ -z "${_docker_host_ip:-}" ]] && info "Host reachability: LB IP $lb_ip — HTTP/1.1, HTTP/2, HTTP/3 verified. Suites will use LB IP."
  else
    if [[ "$ctx" == *"colima"* ]]; then
      info "Host reachability: LB IP $lb_ip — HTTP/1.1, HTTP/2 verified. HTTP/3: colima ssh -- curl -k --http3-only https://$lb_ip/_caddy/healthz  (or use bridged: ./scripts/colima-start-k3s-bridged-clean.sh so Mac can curl LB IP directly)."
    else
      info "Host reachability: LB IP $lb_ip — HTTP/1.1, HTTP/2 verified. HTTP/3: use 127.0.0.1:8443 when no-sudo forward is up, or in-VM curl to LB IP."
    fi
  fi
else
  echo "USE_LB_FOR_TESTS=0" >> "$METALLB_ENV"
  echo "PORT=${caddy_nodeport:-30443}" >> "$METALLB_ENV"
  echo "HTTP3_LB_IP_OK=${_http3_lb_ok:-0}" >> "$METALLB_ENV"
  echo "HTTP3_NODEPORT_OK=${_http3_np_ok:-0}" >> "$METALLB_ENV"
  if [[ "$ctx" == *"colima"* ]]; then
    info "LB IP not reachable — MetalLB-only: ensure METALLB_POOL on VM network (e.g. METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/install-metallb-colima.sh). No socat."
  else
    info "LB IP not reachable — on k3d run: LB_IP=\$lb_ip NODEPORT=$caddy_nodeport $SCRIPT_DIR/setup-lb-ip-host-access.sh. No NodePort fallback."
  fi
fi
exit 0
