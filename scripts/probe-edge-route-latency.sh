#!/usr/bin/env bash
# Probe edge URLs (through Caddy) for HTTP 200 and total time under LATENCY_SLA_MS.
# Uses the same --resolve pattern as smoke-test-dev.sh when MetalLB / NodePort is available.
#
# Usage: ./scripts/probe-edge-route-latency.sh
# Env:
#   HOST / PORT / CA_CERT — same defaults as smoke-test-dev.sh
#   LATENCY_SLA_MS — max curl time_total per path in ms (default 5000; cold bootstrap)
#   E2E_API_BASE — ignored; probes use https://HOST:PORT/path
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST="${HOST:-off-campus-housing.test}"
PORT="${PORT:-443}"
CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"
MAX_MS="${LATENCY_SLA_MS:-5000}"
# Strict gateway (OCH_ENFORCE_X_SUITE): label edge SLA traffic (default matches cold-bootstrap / matrix bash).
export OCH_X_SUITE="${OCH_X_SUITE:-bash}"

ENDPOINTS=(
  "/api/readyz"
  "/api/auth/healthz"
  "/api/listings/healthz"
  "/api/trust/healthz"
)

failures=()

TARGET_IP=""
if [[ -n "${CADDY_TARGET:-}" ]]; then
  TARGET_IP="$CADDY_TARGET"
elif kubectl get svc -n ingress-nginx caddy-h3 &>/dev/null 2>&1; then
  TARGET_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -z "$TARGET_IP" ]]; then
    PORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || true)
    TARGET_IP="127.0.0.1"
  else
    PORT=443
  fi
fi

CURL_BASE=(
  curl -sS -o /dev/null -w "%{http_code} %{time_total}"
  --connect-timeout 8 --max-time 60
  -H "x-traffic-class: infra"
  -H "x-suite: ${OCH_X_SUITE}"
)
if [[ -f "$CA_CERT" ]]; then
  CURL_BASE+=(--cacert "$CA_CERT")
else
  CURL_BASE+=(-k)
fi
if [[ -n "$TARGET_IP" ]]; then
  CURL_BASE+=(--resolve "${HOST}:${PORT}:${TARGET_IP}")
fi

probe() {
  local path="$1"
  local url="https://${HOST}:${PORT}${path}"
  echo "  ▶ probing $url"

  local result code t ms
  result="$("${CURL_BASE[@]}" "$url" 2>/dev/null || echo "000 9.999")"
  code="$(echo "$result" | awk '{print $1}')"
  t="$(echo "$result" | awk '{print $2}')"
  ms="$(awk -v x="$t" 'BEGIN { printf "%d", x * 1000 }')"

  echo "    → HTTP $code, ${ms}ms"

  if [[ "$code" != "200" ]]; then
    echo "::error::$path returned $code"
    failures+=("$path:status")
  fi
  if [[ "$code" == "200" ]] && (( ms > MAX_MS )); then
    echo "::error::$path slow (${ms}ms > ${MAX_MS}ms)"
    failures+=("$path:latency")
  fi
}

printf '\n\033[1m%s\033[0m\n' "probe-edge-route-latency (HOST=$HOST PORT=$PORT SLA=${MAX_MS}ms)"

if [[ -z "$TARGET_IP" ]]; then
  echo "⚠️  No Caddy target (caddy-h3 / CADDY_TARGET) — curling without --resolve (needs DNS/hosts for $HOST)" >&2
fi

for ep in "${ENDPOINTS[@]}"; do
  probe "$ep"
done

if [[ ${#failures[@]} -gt 0 ]]; then
  echo "❌ latency probe failed:" >&2
  printf '  %s\n' "${failures[@]}" >&2
  exit 1
fi

echo "✅ edge routes within SLA"
