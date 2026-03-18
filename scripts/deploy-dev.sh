#!/usr/bin/env bash
# Canonical dev deploy: k3s up → namespace → secrets → ConfigMap → manifests → wait readiness → smoke test.
# External infra (Postgres 5441–5447, Kafka, Redis) must be up; run bootstrap-all-dbs.sh or restore-auth-db.sh first.
#
# Usage: ./scripts/deploy-dev.sh
#   SKIP_SMOKE=1     — do not run smoke test after deploy
#   SKIP_K6=1        — do not run k6 after smoke
#   DEPLOY_OVERLAY=  — kustomize overlay (default: overlays/dev)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

# 1) k3s / context
if ! kubectl config current-context &>/dev/null; then
  warn "No kube context. Start k3s/Colima and ensure kubectl points at the cluster."
  exit 1
fi
ok "Context: $(kubectl config current-context)"

# 2) Namespace(s)
NS="${NAMESPACE:-off-campus-housing-tracker}"
for n in "$NS" ingress-nginx envoy-test; do
  kubectl create namespace "$n" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true
done
ok "Namespaces present"

# 3) Secrets (must exist; create via strict-tls-bootstrap / rotate-ca etc.)
if ! kubectl get secret -n "$NS" app-secrets &>/dev/null 2>&1; then
  warn "app-secrets not found in $NS. Create TLS/secrets first (e.g. scripts/strict-tls-bootstrap.sh)."
fi
if ! kubectl get secret -n ingress-nginx record-local-tls dev-root-ca &>/dev/null 2>&1; then
  warn "Caddy TLS secrets (record-local-tls, dev-root-ca) missing in ingress-nginx. Run scripts/rollout-caddy.sh after creating secrets."
fi

# 4) ConfigMap (canonical DATABASE_HOST + ports)
KUST_DIR="$REPO_ROOT/infra/k8s"
if [[ -d "$KUST_DIR/base/config" ]]; then
  kubectl apply -f "$KUST_DIR/base/config/app-config.yaml" -n "$NS" 2>/dev/null || true
  ok "ConfigMap app-config applied"
fi

# 5) Apply manifests (kustomize or raw)
DEPLOY_OVERLAY="${DEPLOY_OVERLAY:-overlays/dev}"
if [[ -d "$KUST_DIR/$DEPLOY_OVERLAY" ]] && command -v kustomize &>/dev/null 2>&1; then
  say "Applying kustomize $DEPLOY_OVERLAY..."
  kustomize build "$KUST_DIR/$DEPLOY_OVERLAY" | kubectl apply -f - || true
else
  info "No kustomize overlay or kustomize not found; apply base manifests manually."
  if [[ -d "$KUST_DIR/base" ]]; then
    for d in config auth-service; do
      [[ -d "$KUST_DIR/base/$d" ]] && kubectl apply -k "$KUST_DIR/base/$d" -n "$NS" 2>/dev/null || true
    done
  fi
fi

# 6) Caddy + Envoy (if present)
[[ -f "$SCRIPT_DIR/rollout-caddy.sh" ]] && "$SCRIPT_DIR/rollout-caddy.sh" || true
kubectl rollout status deployment/envoy-test -n envoy-test --timeout=120s 2>/dev/null || true

# 7) Wait for deployments in app namespace
say "Waiting for deployments (readiness)..."
for dep in api-gateway auth-service; do
  if kubectl get deployment -n "$NS" "$dep" &>/dev/null 2>&1; then
    kubectl rollout status deployment/"$dep" -n "$NS" --timeout=300s 2>/dev/null || true
    ok "$dep ready"
  fi
done

# 8) Smoke test
if [[ "${SKIP_SMOKE:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/smoke-test-dev.sh" ]]; then
  say "Running smoke test..."
  "$SCRIPT_DIR/smoke-test-dev.sh" || warn "Smoke test had failures"
fi

# 9) Optional k6
if [[ "${SKIP_K6:-1}" != "1" ]] && [[ -f "$SCRIPT_DIR/load/run-k6-phases.sh" ]]; then
  export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
  if [[ -s "${K6_CA_ABSOLUTE:-}" ]]; then
    say "Running k6 (messaging phase)..."
    K6_PHASES=messaging "$SCRIPT_DIR/load/run-k6-phases.sh" || true
  fi
fi

ok "Deploy-dev complete."
