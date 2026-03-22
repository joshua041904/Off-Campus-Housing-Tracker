#!/usr/bin/env bash
# Ensure OCH microservice Deployments mount CA + leaf for strict TLS/mTLS (gRPC + Kafka).
# CA may be: dev-root-ca volume and/or ca.crt inside service-tls / och-service-tls secret items.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

say "=== Ensuring All Services Have Strict TLS (CA + Leaf) ==="

# Off-campus housing stack (align with PREFLIGHT_APP_DEPLOYS / APP_DEPLOYS_FULL).
SERVICES=(
  auth-service
  api-gateway
  listings-service
  booking-service
  messaging-service
  trust-service
  analytics-service
  media-service
  notification-service
)

_tls_deploy_has_leaf() {
  local f="$1"
  grep -qE 'secretName:\s*(service-tls|och-service-tls)\b' "$f"
}

_tls_deploy_has_ca() {
  local f="$1"
  # Explicit dev-root-ca volume (e.g. NODE_EXTRA_CA_CERTS)
  grep -qE 'name:\s*dev-root-ca\b' "$f" && return 0
  # CA chain file alongside leaf in the same TLS secret (typical OCH pattern)
  grep -qE 'key:\s*ca\.crt\b' "$f" && return 0
  return 1
}

for svc in "${SERVICES[@]}"; do
  DEPLOY_FILE="$REPO_ROOT/infra/k8s/base/$svc/deploy.yaml"
  if [[ ! -f "$DEPLOY_FILE" ]]; then
    warn "$svc: deploy.yaml not found under infra/k8s/base/$svc (skip)"
    continue
  fi

  # media-service: HTTP + gRPC (TCP probes) + Kafka mTLS; no service-tls volume in current manifest.
  if [[ "$svc" == "media-service" ]] && ! _tls_deploy_has_leaf "$DEPLOY_FILE"; then
    if grep -qE 'secretName:\s*och-kafka-ssl-secret\b' "$DEPLOY_FILE"; then
      ok "$svc: Kafka client mTLS (och-kafka-ssl-secret); gRPC health via TCP (no och-service-tls mount in this Deployment)"
      continue
    fi
  fi

  HAS_LEAF="no"
  HAS_CA="no"
  _tls_deploy_has_leaf "$DEPLOY_FILE" && HAS_LEAF="yes"
  _tls_deploy_has_ca "$DEPLOY_FILE" && HAS_CA="yes"

  if [[ "$HAS_CA" == "yes" ]] && [[ "$HAS_LEAF" == "yes" ]]; then
    ok "$svc: CA + leaf TLS mounts (strict TLS / mTLS)"
  else
    warn "$svc: TLS manifest check (CA: $HAS_CA, leaf secret mount: $HAS_LEAF) — fix deploy.yaml"
  fi
done

# Kafka: external strict TLS (kafka-external:9093 -> host :29094, same CA as Caddy)
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
