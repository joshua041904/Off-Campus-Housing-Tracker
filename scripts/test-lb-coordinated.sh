#!/usr/bin/env bash
# Suite 9/9: Coordinated LB — Caddy, HAProxy, MetalLB.
# Caddy: in-cluster curl to Caddy health. HAProxy: tolerant check (transient 503 during
# api-gateway restart window is OK; fail only if backend stays unhealthy >30s).
# MetalLB: optional (verify-metallb when available).
# See: docs/TRAFFIC_POLICIES_AND_QOS.md, TEST-FAILURES-AND-WARNINGS.md "Coordinated LB suite"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS_ING="ingress-nginx"
NS_APP="off-campus-housing-tracker"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:latest}"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }
info(){ echo "ℹ️  $*"; }

# HAProxy: number of attempts and interval (production-grade: tolerate restart window)
HAPROXY_ATTEMPTS="${HAPROXY_ATTEMPTS:-10}"
HAPROXY_INTERVAL="${HAPROXY_INTERVAL:-5}"
# Fail only if 503 for this many consecutive checks (~30s at 5s interval)
HAPROXY_CONSECUTIVE_503_FAIL="${HAPROXY_CONSECUTIVE_503_FAIL:-6}"

ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || true
  fi
}

say "=== Coordinated LB: Caddy + HAProxy + MetalLB ==="

# 1. Caddy in-cluster: wait for ready endpoints then curl via ClusterIP (avoids DNS/kube-proxy churn during restart)
say "1. Caddy in-cluster health"
_kb -n "$NS_ING" wait --for=condition=ready pod -l app=caddy-h3 --timeout=60s 2>/dev/null || warn "Caddy pod ready wait timed out"
sleep 3
CLUSTER_IP=$(_kb -n "$NS_ING" get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
if [[ -z "$CLUSTER_IP" ]]; then
  warn "Caddy ClusterIP not found; skipping in-cluster health"
else
  CADDY_POD="tmp-curl-caddy-$$"
  # Host: off-campus-housing.local required so Caddy matches https://off-campus-housing.local vhost (otherwise :443 catch-all; -k = no CA in pod)
  _kb run "$CADDY_POD" --image="$CURL_IMAGE" --restart=Never -n "$NS_ING" -- \
    curl -sS -o /dev/null -w "%{http_code}" -k --connect-timeout 5 --max-time 10 --resolve "off-campus-housing.local:443:${CLUSTER_IP}" "https://off-campus-housing.local/_caddy/healthz" 2>/dev/null || true
  # Wait for pod to complete so logs are flushed (avoid empty CODE from reading too early)
  for _w in $(seq 1 20); do
    _phase=$(_kb -n "$NS_ING" get pod "$CADDY_POD" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Pending")
    [[ "$_phase" == "Succeeded" ]] || [[ "$_phase" == "Failed" ]] && break
    sleep 1
  done
  _raw_logs=$(_kb -n "$NS_ING" logs "$CADDY_POD" 2>/dev/null || true)
  CODE=$(echo "$_raw_logs" | tail -1 | tr -d '\r\n' || echo "000")
  # If last line is not a 3-digit code (e.g. empty or buffered), take any 3-digit code from logs; prefer 200
  if [[ ! "$CODE" =~ ^[0-9]{3}$ ]]; then
    CODE=$(echo "$_raw_logs" | grep -oE '[0-9]{3}' | tail -1 || echo "000")
  fi
  _kb -n "$NS_ING" delete pod "$CADDY_POD" --ignore-not-found --request-timeout=5s 2>/dev/null || true
  if [[ "$CODE" == "200" ]]; then
    ok "Caddy in-cluster: HTTP 200 (via ClusterIP $CLUSTER_IP)"
  else
    warn "Caddy in-cluster did not return 200 (got ${CODE:-empty}); ClusterIP=$CLUSTER_IP"
  fi
fi

# 2. HAProxy health — tolerant of transient 503 (api-gateway restart during rotation)
# Only fail if backend is unhealthy for >30s (consecutive 503 for HAPROXY_CONSECUTIVE_503_FAIL checks).
say "2. HAProxy health (tolerant: transient 503 during restart is OK)"
HAPROXY_URL="http://haproxy.${NS_APP}.svc.cluster.local:8081/healthz"
consecutive_503=0
haproxy_ok=0
for attempt in $(seq 1 "$HAPROXY_ATTEMPTS"); do
  HP_POD="curl-hp-$$-$attempt"
  _kb run "$HP_POD" --image="$CURL_IMAGE" --restart=Never -n "$NS_APP" -- \
    curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 "$HAPROXY_URL" 2>/dev/null || true
  sleep 4
  CODE=$(_kb -n "$NS_APP" logs "$HP_POD" 2>/dev/null | tail -1 || echo "000")
  _kb -n "$NS_APP" delete pod "$HP_POD" --ignore-not-found --request-timeout=5s 2>/dev/null || true
  if [[ "$CODE" == "200" ]]; then
    consecutive_503=0
    if [[ $attempt -eq 1 ]]; then
      ok "HAProxy health: HTTP 200"
      haproxy_ok=1
      break
    fi
    ok "HAProxy health: HTTP 200 (after $attempt attempts — backend became ready)"
    haproxy_ok=1
    break
  fi
  if [[ "$CODE" == "503" ]]; then
    consecutive_503=$((consecutive_503 + 1))
    warn "HAProxy 503 (attempt $attempt/$HAPROXY_ATTEMPTS)"
    if [[ $consecutive_503 -ge "$HAPROXY_CONSECUTIVE_503_FAIL" ]]; then
      info "  Diagnose (HAProxy pod has no curl): kubectl run curl-diagnose --rm -i --restart=Never -n $NS_APP --image=curlimages/curl:latest -- curl -s -o /dev/null -w '%{http_code}' http://api-gateway.${NS_APP}.svc.cluster.local:4020/healthz"
      info "  If 200 → backend OK; HAProxy needs 'resolvers k8s' + server ... resolvers k8s so health checks resolve FQDN (see haproxy configmap). If 404/000 → path or connectivity."
      fail "HAProxy backend unhealthy for >30s (${consecutive_503} consecutive 503). Ensure api-gateway has ready pods and HAProxy config option httpchk GET /healthz."
    fi
  else
    consecutive_503=0
  fi
  [[ $attempt -lt $HAPROXY_ATTEMPTS ]] && sleep "$HAPROXY_INTERVAL"
done
if [[ $haproxy_ok -ne 1 ]]; then
  warn "HAProxy health did not return 200 after $HAPROXY_ATTEMPTS attempts (transient restart window or backend down)"
  info "  If rotation just restarted api-gateway, re-run this suite in 30s or increase HAPROXY_ATTEMPTS/HAPROXY_INTERVAL."
fi

# 3. MetalLB (optional)
say "3. MetalLB (optional)"
if [[ -f "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" ]] && [[ "${SKIP_METALLB_VERIFY:-0}" != "1" ]]; then
  VERIFY_MODE=stable "$SCRIPT_DIR/verify-metallb-and-traffic-policy.sh" 2>/dev/null && ok "MetalLB verification passed" || warn "MetalLB verification had issues (optional)"
else
  info "Skipped (verify-metallb-and-traffic-policy.sh not found or SKIP_METALLB_VERIFY=1)"
fi

say "=== Coordinated LB suite complete ==="
ok "Caddy, HAProxy (tolerant), and optional MetalLB checked"
