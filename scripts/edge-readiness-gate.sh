#!/usr/bin/env bash
# MetalLB IP on caddy-h3 + in-cluster Caddy health + api-gateway /healthz (deterministic edge invariants).
#
# Env:
#   NS_ING — default ingress-nginx
#   HOUSING_NS — default off-campus-housing-tracker
#   EDGE_READINESS_GATE_SKIP=1 — no-op success
#   EDGE_GATEWAY_DEPLOY — default api-gateway
set -euo pipefail

NS_ING="${NS_ING:-ingress-nginx}"
NS_APP="${HOUSING_NS:-off-campus-housing-tracker}"
GW_DEPLOY="${EDGE_GATEWAY_DEPLOY:-api-gateway}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

if [[ "${EDGE_READINESS_GATE_SKIP:-0}" == "1" ]]; then
  say "=== edge-readiness-gate (skipped) ==="
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required"; exit 1; }

say "=== edge-readiness-gate (caddy-h3 @$NS_ING, $GW_DEPLOY @$NS_APP) ==="

_ip="$(kubectl get svc caddy-h3 -n "$NS_ING" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' --request-timeout=25s 2>/dev/null | tr -d '\r')"
if [[ -z "$_ip" ]]; then
  bad "caddy-h3 has no LoadBalancer IP yet"
  exit 1
fi
ok "caddy-h3 LoadBalancer IP: $_ip"

if ! kubectl get deploy caddy-h3 -n "$NS_ING" --request-timeout=20s >/dev/null 2>&1; then
  bad "deploy/caddy-h3 not found in $NS_ING"
  exit 1
fi

_cc="$(
  kubectl exec -n "$NS_ING" deploy/caddy-h3 -c caddy --request-timeout=30s -- \
    sh -c 'if command -v curl >/dev/null 2>&1; then curl -gksS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 https://127.0.0.1:443/_caddy/healthz; elif command -v wget >/dev/null 2>&1; then wget -q -O /dev/null --timeout=15 --no-check-certificate https://127.0.0.1:443/_caddy/healthz && echo 200; else echo 000; fi' 2>/dev/null || echo "000"
)"
if [[ "$_cc" != "200" ]]; then
  bad "Caddy in-pod /_caddy/healthz HTTP $_cc (expected 200)"
  exit 1
fi
ok "Caddy /_caddy/healthz HTTP 200 (in-cluster)"

if kubectl get deploy "$GW_DEPLOY" -n "$NS_APP" --request-timeout=20s >/dev/null 2>&1; then
  _gc="$(
    kubectl exec -n "$NS_APP" "deploy/$GW_DEPLOY" -c app --request-timeout=30s -- \
      sh -c 'if command -v curl >/dev/null 2>&1; then curl -gfsS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 15 http://127.0.0.1:4020/healthz; elif command -v wget >/dev/null 2>&1; then wget -q -O /dev/null --timeout=15 http://127.0.0.1:4020/healthz && echo 200; else echo 000; fi' 2>/dev/null || echo "000"
  )"
  if [[ "$_gc" != "200" ]]; then
    bad "api-gateway /healthz HTTP $_gc (expected 200)"
    exit 1
  fi
  ok "api-gateway /healthz HTTP 200 (in-pod)"
  _gz="$(
    kubectl exec -n "$NS_APP" "deploy/$GW_DEPLOY" -c app --request-timeout=45s -- \
      sh -c 'if command -v curl >/dev/null 2>&1; then curl -gfsS -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 25 http://127.0.0.1:4020/readyz; elif command -v wget >/dev/null 2>&1; then wget -q -O /dev/null --timeout=25 http://127.0.0.1:4020/readyz && echo 200; else echo 000; fi' 2>/dev/null || echo "000"
  )"
  if [[ "$_gz" != "200" ]]; then
    bad "api-gateway /readyz HTTP $_gz (expected 200 — auth gRPC / deps not ready)"
    exit 1
  fi
  ok "api-gateway /readyz HTTP 200 (in-pod)"
else
  echo "   ℹ️  deploy/$GW_DEPLOY not found — skipped gateway check"
fi

ok "edge-readiness-gate PASSED"
