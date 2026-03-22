#!/usr/bin/env bash
# Smoke test after deploy-dev: Caddy health, gateway health, auth/messaging health endpoints.
# Usage: ./scripts/smoke-test-dev.sh
#   BASE_URL=https://off-campus-housing.test  (default from PORT/LB)
#   CADDY_TARGET=127.0.0.1  PORT=30443  (NodePort)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="${HOST:-off-campus-housing.test}"
PORT="${PORT:-443}"
CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; }

# Resolve Caddy endpoint
TARGET_IP=""
if [[ -n "${CADDY_TARGET:-}" ]]; then
  TARGET_IP="$CADDY_TARGET"
  [[ "$PORT" == "443" ]] || true
elif kubectl get svc -n ingress-nginx caddy-h3 &>/dev/null 2>&1; then
  TARGET_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -z "$TARGET_IP" ]]; then
    PORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || true)
    TARGET_IP="127.0.0.1"
  else
    PORT=443
  fi
fi

if [[ -z "$TARGET_IP" ]]; then
  warn "Caddy not found; skip smoke test"
  exit 0
fi

CURL_OPTS=(-sS -o /dev/null -w "%{http_code}" --max-time 10 --connect-timeout 3)
[[ -f "$CA_CERT" ]] && CURL_OPTS+=(--cacert "$CA_CERT") || CURL_OPTS+=(-k)

# Caddy health
code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/_caddy/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Caddy health 200"; else fail "Caddy health $code"; fi

# Gateway health (via Caddy)
code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Gateway health 200"; else fail "Gateway health $code"; fi

# Messaging health (if gateway routes it)
code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/api/messaging/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Messaging health 200"; else warn "Messaging health $code (service may not be deployed)"; fi

# Listings + trust (housing)
code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/api/listings/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Listings health 200"; else warn "Listings health $code (service may not be deployed)"; fi

code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/api/trust/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Trust health 200"; else warn "Trust health $code (service may not be deployed)"; fi

code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/api/media/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Media health 200"; else warn "Media health $code (service may not be deployed)"; fi

code=$(curl "${CURL_OPTS[@]}" --resolve "${HOST}:${PORT}:${TARGET_IP}" "https://${HOST}:${PORT}/api/notification/healthz" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then ok "Notification health 200"; else warn "Notification health $code (service may not be deployed)"; fi

echo "Smoke test done."
