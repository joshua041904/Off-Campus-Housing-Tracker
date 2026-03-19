#!/usr/bin/env bash
# Ensure Caddy H3 (2 pods) and Envoy (1 pod) are running with strict TLS/mTLS and certs loaded.
# Namespaces: ingress-nginx (Caddy), envoy-test (Envoy). Use before or with run-preflight-scale-and-all-suites.sh.
#
# Prerequisites: certs in ./certs/ (dev-root.pem, off-campus-housing.local.crt/key, envoy-client.crt/key).
#   Create with: KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh
#   Then: ./scripts/generate-envoy-client-cert.sh
#   Then: ./scripts/strict-tls-bootstrap.sh  (or this script will run it if certs exist)
#
# Usage: ./scripts/ensure-caddy-envoy-strict-tls.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NS_INGRESS="${NS_INGRESS:-ingress-nginx}"
NS_ENVOY="${NS_ENVOY:-envoy-test}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

say "=== Ensure Caddy H3 (2 pods) + Envoy (1 pod) with strict TLS/mTLS ==="

# 1. Namespaces
kubectl create namespace "$NS_INGRESS" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
kubectl create namespace "$NS_ENVOY" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
ok "Namespaces $NS_INGRESS, $NS_ENVOY ensured"

# 2. TLS secrets (off-campus-housing-local-tls, dev-root-ca in ingress-nginx; dev-root-ca, envoy-client-tls in envoy-test)
TLS_SECRET="${TLS_SECRET:-off-campus-housing-local-tls}"
if [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && [[ -f "$REPO_ROOT/certs/off-campus-housing.local.crt" ]] && [[ -f "$REPO_ROOT/certs/off-campus-housing.local.key" ]]; then
  if ! kubectl -n "$NS_INGRESS" get secret "$TLS_SECRET" &>/dev/null || ! kubectl -n "$NS_INGRESS" get secret dev-root-ca &>/dev/null; then
    info "Creating TLS secrets (strict-tls-bootstrap)..."
    "$SCRIPT_DIR/strict-tls-bootstrap.sh" 2>&1 || warn "strict-tls-bootstrap had issues (secrets may already exist)"
  else
    ok "TLS secrets ($TLS_SECRET, dev-root-ca) present in $NS_INGRESS"
  fi
  if ! kubectl -n "$NS_ENVOY" get secret dev-root-ca &>/dev/null; then
    kubectl -n "$NS_ENVOY" create secret generic dev-root-ca --from-file=dev-root.pem="$REPO_ROOT/certs/dev-root.pem" -o yaml --dry-run=client | kubectl apply -f - 2>/dev/null || true
  fi
  if [[ -f "$REPO_ROOT/certs/envoy-client.crt" ]] && [[ -f "$REPO_ROOT/certs/envoy-client.key" ]]; then
    kubectl -n "$NS_ENVOY" delete secret envoy-client-tls --ignore-not-found 2>/dev/null || true
    kubectl -n "$NS_ENVOY" create secret generic envoy-client-tls \
      --from-file=envoy.crt="$REPO_ROOT/certs/envoy-client.crt" \
      --from-file=envoy.key="$REPO_ROOT/certs/envoy-client.key" 2>/dev/null || true
    ok "Envoy client secret envoy-client-tls ensured in $NS_ENVOY"
  else
    warn "certs/envoy-client.crt or .key missing; run ./scripts/generate-envoy-client-cert.sh (Envoy mTLS may fail)"
  fi
else
  warn "certs/dev-root.pem or off-campus-housing.local.crt/key missing. Run: KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh then ./scripts/strict-tls-bootstrap.sh"
  exit 1
fi

# 3. Caddy: use LoadBalancer on Colima when MetalLB present, else NodePort
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]] && kubectl get ns metallb-system --request-timeout=3s &>/dev/null 2>&1; then
  export CADDY_USE_LOADBALANCER=1
  info "Colima + MetalLB: using Caddy LoadBalancer (2 replicas, no hostPort)"
else
  export CADDY_USE_LOADBALANCER=0
  info "Using Caddy NodePort (2 replicas)"
fi
"$SCRIPT_DIR/rollout-caddy.sh" 2>&1 || { warn "rollout-caddy failed; check Caddyfile and secrets"; exit 1; }

# 4. Envoy (base manifest: 1 replica, dev-root-ca + envoy-client-tls)
if [[ -d "$REPO_ROOT/infra/k8s/base/envoy-test" ]]; then
  kubectl apply -k "$REPO_ROOT/infra/k8s/base/envoy-test" --request-timeout=20s 2>/dev/null && ok "Envoy (envoy-test) applied" || warn "Envoy apply failed (may already be present)"
else
  warn "infra/k8s/base/envoy-test not found; skip Envoy apply"
fi

# 5. Scale to desired replicas: Caddy 2, Envoy 1
kubectl scale deploy caddy-h3 -n "$NS_INGRESS" --replicas=2 --request-timeout=15s 2>/dev/null || true
kubectl scale deploy envoy-test -n "$NS_ENVOY" --replicas=1 --request-timeout=15s 2>/dev/null || true
ok "Scaled caddy-h3=2, envoy-test=1"

# 6. Wait for rollouts
say "Waiting for Caddy and Envoy rollouts..."
if kubectl rollout status deploy/caddy-h3 -n "$NS_INGRESS" --timeout=120s 2>&1; then
  ok "Caddy H3 rollout complete (2 pods)"
else
  warn "Caddy rollout did not complete in time; check: kubectl get pods -n $NS_INGRESS -l app=caddy-h3"
fi
if kubectl get deploy envoy-test -n "$NS_ENVOY" &>/dev/null; then
  if kubectl rollout status deploy/envoy-test -n "$NS_ENVOY" --timeout=90s 2>&1; then
    ok "Envoy rollout complete (1 pod)"
  else
    warn "Envoy rollout did not complete in time; check: kubectl get pods -n $NS_ENVOY"
  fi
fi

echo ""
echo "Summary:"
kubectl get pods -n "$NS_INGRESS" -l app=caddy-h3 -o wide 2>/dev/null || true
kubectl get pods -n "$NS_ENVOY" -l app=envoy-test -o wide 2>/dev/null || true
say "Next: run ./scripts/run-preflight-scale-and-all-suites.sh (or verify with ./scripts/verify-metallb-and-traffic-policy.sh from repo root)"
