#!/usr/bin/env bash
# Idiot-proof one-shot: certs → TLS secrets → Caddy (ingress-nginx) + Envoy (envoy-test) + app namespace (off-campus-housing-tracker).
# All steps run sequentially so teammates don't get stuck on certs. Caddy and Envoy pods get tcpdump (custom images).
#
# Prereqs: kubectl, docker, openssl. Cluster running (e.g. Colima or k3d).
#
# Usage: ./scripts/setup-tls-and-edge.sh
#   SKIP_BUILD_TCPDUMP=1  skip building caddy-with-tcpdump and envoy-with-tcpdump (use existing images)
#
# What this does:
#   1. Create namespaces: ingress-nginx (Caddy), envoy-test (Envoy), off-campus-housing-tracker (app pods)
#   2. Generate all certs (CA, Caddy leaf, Envoy client, service leaves) — no manual cert steps
#   3. Load TLS secrets into cluster (strict-tls-bootstrap)
#   4. Build Caddy (xcaddy + tcpdump, HTTP/3) and Envoy (envoy + tcpdump) images
#   5. Roll out Caddy (2 pods) in ingress-nginx with LoadBalancer when Colima+MetalLB
#   6. Apply Envoy (1 pod) in envoy-test with mTLS to backends
#   7. Patch Envoy to use envoy-with-tcpdump image; Caddy deploy already uses caddy-with-tcpdump
#   8. Wait for rollouts and print summary
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

say "=== TLS + Edge setup (Caddy + Envoy + namespaces) — run from repo root ==="

# --- 1. Namespaces (Caddy in ingress-nginx, Envoy in envoy-test, app in off-campus-housing-tracker) ---
say "Step 1/7: Create namespaces (ingress-nginx, envoy-test, off-campus-housing-tracker)"
for ns in ingress-nginx envoy-test off-campus-housing-tracker; do
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
done
ok "Namespaces ensured"

# --- 2. Generate all certs (CA, Caddy leaf, Envoy client, services) ---
say "Step 2/7: Generate certs (CA, off-campus-housing.test, envoy-client, services)"
"$SCRIPT_DIR/dev-generate-certs.sh" 2>&1 || true
if [[ ! -f "$REPO_ROOT/certs/off-campus-housing.test.crt" ]] || [[ ! -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  echo "ERROR: Required certs missing after dev-generate-certs. Check certs/ and run again." >&2
  exit 1
fi
# Envoy client cert requires dev-root.key (created by dev-generate-certs)
if [[ -f "$REPO_ROOT/certs/dev-root.key" ]]; then
  if [[ ! -f "$REPO_ROOT/certs/envoy-client.crt" ]] || [[ ! -f "$REPO_ROOT/certs/envoy-client.key" ]]; then
    "$SCRIPT_DIR/generate-envoy-client-cert.sh" 2>&1 || true
  else
    ok "Envoy client cert already present"
  fi
else
  warn "certs/dev-root.key missing; Envoy client cert not generated. Envoy mTLS may need it later."
fi
ok "Certs ready in certs/"

# --- 3. Load TLS secrets into cluster ---
say "Step 3/7: Load TLS secrets (strict-tls-bootstrap)"
"$SCRIPT_DIR/strict-tls-bootstrap.sh" 2>&1 || { warn "strict-tls-bootstrap had issues (secrets may already exist)"; true; }
ok "TLS secrets in ingress-nginx, off-campus-housing-tracker, envoy-test"

# --- 4. Build Caddy (xcaddy + tcpdump) and Envoy (envoy + tcpdump) images ---
say "Step 4/7: Build caddy-with-tcpdump and envoy-with-tcpdump (for packet capture)"
if [[ "${SKIP_BUILD_TCPDUMP:-0}" != "1" ]]; then
  if [[ -f "$REPO_ROOT/docker/caddy-with-tcpdump/Dockerfile" ]]; then
    docker build -t caddy-with-tcpdump:dev -f docker/caddy-with-tcpdump/Dockerfile . 2>&1 | tail -3
    ok "Built caddy-with-tcpdump:dev (xcaddy, HTTP/3, tcpdump)"
  fi
  if [[ -f "$REPO_ROOT/docker/envoy-with-tcpdump/Dockerfile" ]]; then
    docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-tcpdump/Dockerfile . 2>&1 | tail -3
    ok "Built envoy-with-tcpdump:dev"
  fi
else
  info "SKIP_BUILD_TCPDUMP=1: using existing *-with-tcpdump images"
fi

# --- 5. Roll out Caddy in ingress-nginx ---
say "Step 5/7: Roll out Caddy (ingress-nginx, 2 replicas)"
ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" == *"colima"* ]] && kubectl get ns metallb-system --request-timeout=3s &>/dev/null 2>&1; then
  export CADDY_USE_LOADBALANCER=1
  info "Colima + MetalLB: Caddy LoadBalancer"
else
  export CADDY_USE_LOADBALANCER=0
  info "Caddy NodePort (no MetalLB)"
fi
"$SCRIPT_DIR/rollout-caddy.sh" 2>&1 || { warn "rollout-caddy failed; check Caddyfile and secrets"; exit 1; }

# --- 6. Apply Envoy in envoy-test ---
say "Step 6/7: Apply Envoy (envoy-test, 1 replica)"
if [[ -d "$REPO_ROOT/infra/k8s/base/envoy-test" ]]; then
  kubectl apply -k "$REPO_ROOT/infra/k8s/base/envoy-test" --request-timeout=30s 2>/dev/null && ok "Envoy applied" || warn "Envoy apply failed (may already exist)"
else
  warn "infra/k8s/base/envoy-test not found"
fi
kubectl scale deploy envoy-test -n envoy-test --replicas=1 --request-timeout=15s 2>/dev/null || true

# --- 7. Patch Envoy to use envoy-with-tcpdump (Caddy deploy already uses caddy-with-tcpdump:dev) ---
say "Step 7/7: Ensure Caddy and Envoy pods use tcpdump images"
if docker image inspect envoy-with-tcpdump:dev &>/dev/null && kubectl get deployment envoy-test -n envoy-test --request-timeout=5s &>/dev/null; then
  kubectl set image deployment/envoy-test -n envoy-test "envoy=envoy-with-tcpdump:dev" --request-timeout=15s 2>/dev/null && \
    ok "envoy-test -> envoy-with-tcpdump:dev" || warn "Patch envoy-test failed"
  kubectl patch deployment envoy-test -n envoy-test --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]' 2>/dev/null || true
fi
# Caddy deploy YAML already has image: caddy-with-tcpdump:dev; no patch needed if we built it above

say "Waiting for rollouts..."
kubectl rollout status deploy/caddy-h3 -n ingress-nginx --timeout=120s 2>/dev/null || warn "Caddy rollout wait timed out"
kubectl rollout status deploy/envoy-test -n envoy-test --timeout=90s 2>/dev/null || warn "Envoy rollout wait timed out"

echo ""
say "Summary — namespaces and edge pods"
echo "  Namespaces: ingress-nginx (Caddy), envoy-test (Envoy), off-campus-housing-tracker (app services)"
kubectl get pods -n ingress-nginx -l app=caddy-h3 -o wide 2>/dev/null || true
kubectl get pods -n envoy-test -l app=envoy-test -o wide 2>/dev/null || true
echo ""
ok "TLS + edge setup complete. Next: deploy app services to off-campus-housing-tracker or run ./scripts/ensure-caddy-envoy-strict-tls.sh to re-check."
