#!/usr/bin/env bash
# Compare HTTP/2 vs HTTP/3 request headers for the same path (Host, :authority, path).
# Use when resell returns 404 on H3 but 200 on H2, or k6 HTTP/3 shows 0% success.
# Requires: LB IP (from cluster or TARGET_IP), CA cert at REPO_ROOT/certs/dev-root.pem.
#
# Usage:
#   ./scripts/compare-h2-h3-headers.sh
#   TARGET_IP=192.168.64.240 ./scripts/compare-h2-h3-headers.sh
#   ./scripts/compare-h2-h3-headers.sh /_caddy/healthz
#   ./scripts/compare-h2-h3-headers.sh /api/shopping/resell/some-id
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PATH="${SCRIPT_DIR}/shims:${PATH:-}"
ctx=$(kubectl config current-context 2>/dev/null || echo "")

# Resolve LB IP
if [[ -z "${TARGET_IP:-}" ]]; then
  _kb() {
    if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
      colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
    else
      kubectl --request-timeout=10s "$@" 2>/dev/null || true
    fi
  }
  TARGET_IP=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  [[ -z "$TARGET_IP" ]] && TARGET_IP=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
fi
if [[ -z "$TARGET_IP" ]]; then
  echo "TARGET_IP not set and could not get LoadBalancer IP from cluster. Export TARGET_IP or run from preflight context."
  exit 1
fi

PATH="${PATH:-}"
CURL_BIN="${CURL_BIN:-curl}"
CA="${REPO_ROOT}/certs/dev-root.pem"
if [[ ! -f "$CA" ]]; then
  echo "CA cert not found at $CA (run preflight or set REPO_ROOT)."
  exit 1
fi

# Path to test (default health)
TEST_PATH="${1:-/_caddy/healthz}"
URL="https://off-campus-housing.local:443${TEST_PATH}"
RESOLVE="off-campus-housing.local:443:${TARGET_IP}"

echo "=== Compare H2 vs H3 for path: $TEST_PATH (resolve off-campus-housing.local → $TARGET_IP) ==="
echo "Compare in output: Host header, :authority (H2), request path, response status."
echo ""

echo "--- HTTP/2 (--http2) ---"
"$CURL_BIN" -v --http2 \
  --resolve "$RESOLVE" \
  --cacert "$CA" \
  --connect-timeout 5 --max-time 10 \
  "$URL" 2>&1 | head -40
echo ""

echo "--- HTTP/3 (--http3) ---"
"$CURL_BIN" -v --http3 \
  --resolve "$RESOLVE" \
  --cacert "$CA" \
  --connect-timeout 5 --max-time 10 \
  "$URL" 2>&1 | head -40
echo ""

echo "=== Caddy request access log (host, uri, proto): kubectl logs deploy/caddy-h3 -n ingress-nginx --tail=20 ==="
