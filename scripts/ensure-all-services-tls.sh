#!/usr/bin/env bash
# Ensure all services have CA and leaf certificates mounted, and Kafka uses strict TLS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

say "=== Ensuring All Services Have Strict TLS (CA + Leaf) ==="

SERVICES=("auth-service" "records-service" "listings-service" "social-service" "shopping-service" "analytics-service" "auction-monitor" "python-ai-service" "api-gateway")

# Check each service deployment
for svc in "${SERVICES[@]}"; do
  DEPLOY_FILE="$REPO_ROOT/infra/k8s/base/$svc/deploy.yaml"
  if [[ ! -f "$DEPLOY_FILE" ]]; then
    warn "$svc: deploy.yaml not found"
    continue
  fi
  
  HAS_CA=$(grep -q "dev-root-ca" "$DEPLOY_FILE" && echo "yes" || echo "no")
  HAS_LEAF=$(grep -q "service-tls" "$DEPLOY_FILE" && echo "yes" || echo "no")
  
  if [[ "$HAS_CA" == "yes" ]] && [[ "$HAS_LEAF" == "yes" ]]; then
    ok "$svc: Has CA and leaf TLS mounts"
  else
    warn "$svc: Missing TLS mounts (CA: $HAS_CA, Leaf: $HAS_LEAF)"
  fi
done

# Kafka: external strict TLS (kafka-external:9093 -> host :29093, same CA as Caddy)
APP_CONFIG="$REPO_ROOT/infra/k8s/base/config/app-config.yaml"
if [[ -f "$APP_CONFIG" ]]; then
  if grep -q 'KAFKA_USE_SSL: "true"' "$APP_CONFIG" 2>/dev/null && grep -q '9093' "$APP_CONFIG" 2>/dev/null && grep -q 'kafka-external' "$APP_CONFIG" 2>/dev/null; then
    ok "Kafka: strict TLS (kafka-external:9093, KAFKA_USE_SSL=true, dev-root-ca)"
  else
    warn "Kafka: set kafka-external:9093, KAFKA_USE_SSL=true in app-config"
  fi
else
  warn "Kafka: app-config not found"
fi

say "=== TLS Check Complete ==="
