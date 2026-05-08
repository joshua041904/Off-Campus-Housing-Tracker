#!/usr/bin/env bash
# Smoke test after deploy-dev: Caddy health, gateway health, auth/messaging health endpoints.
# Usage: ./scripts/smoke-test-dev.sh
#   BASE_URL=https://off-campus-housing.test  (default from PORT/LB)
#   CADDY_TARGET=127.0.0.1  PORT=30443  (NodePort)
#   SMOKE_HTTP_ATTEMPTS / SMOKE_HTTP_DELAY_SEC — retry until HTTP 200 (kube-dns / Caddy upstream lag)

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

CURL_OPTS=(-sS -o /dev/null -w "%{http_code}" --max-time 15 --connect-timeout 5)
[[ -f "$CA_CERT" ]] && CURL_OPTS+=(--cacert "$CA_CERT") || CURL_OPTS+=(-k)

if command -v curl >/dev/null 2>&1; then
  ok "$(curl --version | head -1)"
fi

_curl_retry_ex=()
if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
  _curl_retry_ex+=(--retry-all-errors)
fi

# GET url → prints last HTTP code (after retries); prefers 200.
_smoke_http_code() {
  local url="$1"
  local attempts="${SMOKE_HTTP_ATTEMPTS:-22}"
  local delay="${SMOKE_HTTP_DELAY_SEC:-2}"
  local code="000" i
  for ((i = 1; i <= attempts; i++)); do
    code="$(curl "${CURL_OPTS[@]}" \
      --retry 5 --retry-delay 1 --retry-connrefused \
      "${_curl_retry_ex[@]}" \
      --resolve "${HOST}:${PORT}:${TARGET_IP}" \
      "$url" 2>/dev/null || echo "000")"
    [[ "$code" == "200" ]] && break
    sleep "$delay"
  done
  printf '%s' "$code"
}

# Caddy health
code="$(_smoke_http_code "https://${HOST}:${PORT}/_caddy/healthz")"
if [[ "$code" == "200" ]]; then ok "Caddy health 200"; else fail "Caddy health $code"; fi

# Gateway health (via Caddy)
code="$(_smoke_http_code "https://${HOST}:${PORT}/healthz")"
if [[ "$code" == "200" ]]; then ok "Gateway health 200"; else fail "Gateway health $code"; fi

# Messaging health (if gateway routes it)
code="$(_smoke_http_code "https://${HOST}:${PORT}/api/messaging/healthz")"
if [[ "$code" == "200" ]]; then ok "Messaging health 200"; else warn "Messaging health $code (service may not be deployed)"; fi

# Listings + trust (housing)
code="$(_smoke_http_code "https://${HOST}:${PORT}/api/listings/healthz")"
if [[ "$code" == "200" ]]; then ok "Listings health 200"; else warn "Listings health $code (service may not be deployed)"; fi

code="$(_smoke_http_code "https://${HOST}:${PORT}/api/trust/healthz")"
if [[ "$code" == "200" ]]; then ok "Trust health 200"; else warn "Trust health $code (service may not be deployed)"; fi

code="$(_smoke_http_code "https://${HOST}:${PORT}/api/media/healthz")"
if [[ "$code" == "200" ]]; then ok "Media health 200"; else warn "Media health $code (service may not be deployed)"; fi

code="$(_smoke_http_code "https://${HOST}:${PORT}/api/notification/healthz")"
if [[ "$code" == "200" ]]; then ok "Notification health 200"; else warn "Notification health $code (service may not be deployed)"; fi

echo "Smoke test done."
