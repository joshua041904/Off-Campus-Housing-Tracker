#!/usr/bin/env bash
# Smoke test: HTTP/2 and HTTP/3 health checks with strict TLS when CA is available.
# All requests use --http2 (H2) or --http3-only (H3); no protocol fallback.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HOST="${HOST:-off-campus-housing.local}"
CURL="${CURL_BIN:-$(command -v curl)}"
command -v "$CURL" >/dev/null || { echo "curl not found"; exit 1; }

# Resolve CA for strict TLS (same priority as test-microservices-http2-http3.sh)
# Use absolute path so harness works regardless of cwd (avoids exit 60 from relative path).
CA_CERT=""
if command -v kubectl >/dev/null 2>&1; then
  K8S_CA=$(kubectl -n off-campus-housing-tracker get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  if [[ -n "$K8S_CA" ]]; then
    CA_CERT="/tmp/smoke-ca-$$.pem"
    echo "$K8S_CA" > "$CA_CERT"
    trap "rm -f $CA_CERT" EXIT
  fi
fi
[[ -z "$CA_CERT" ]] && [[ -f "$REPO_ROOT/certs/dev-root.pem" ]] && CA_CERT="$REPO_ROOT/certs/dev-root.pem"
[[ -z "$CA_CERT" ]] && command -v mkcert >/dev/null 2>&1 && [[ -f "$(mkcert -CAROOT)/rootCA.pem" ]] && CA_CERT="$(mkcert -CAROOT)/rootCA.pem"
[[ -z "$CA_CERT" ]] && [[ -f "/tmp/grpc-certs/ca.crt" ]] && CA_CERT="/tmp/grpc-certs/ca.crt"

strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    "$CURL" --cacert "$CA_CERT" "$@"
  else
    "$CURL" -k "$@"
  fi
}
strict_http3_curl() {
  local ca_args=()
  [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]] && ca_args+=(--cacert "$CA_CERT") || ca_args+=(-k)
  if type http3_curl &>/dev/null 2>&1; then
    HTTP3_CA_CERT="${CA_CERT:-}" http3_curl "${ca_args[@]}" --http3-only "$@"
  elif "$CURL" --help all 2>&1 | grep -q -- "--http3-only"; then
    "$CURL" "${ca_args[@]}" --http3-only "$@"
  else
    return 0
  fi
}

# Ensure host resolves (optional: add off-campus-housing.local to /etc/hosts if needed)
if ! getent hosts "$HOST" &>/dev/null && ! grep -q "$HOST" /etc/hosts 2>/dev/null; then
  echo "Add $HOST to /etc/hosts or set HOST= to your gateway. Continuing..."
fi

echo "Smoke test: strict HTTP/2 and HTTP/3 (HOST=$HOST, CA=${CA_CERT:-insecure})"
echo ""

printf "%-28s " "/api/whoami (H2)"
strict_curl -sS --http2 -H "Host: $HOST" "https://$HOST/api/whoami" 2>/dev/null | head -c 80 || true
echo ""

echo "== HTTP/2 (strict) =="
for p in /api/healthz /api/auth/healthz /api/records/healthz /api/listings/healthz /api/analytics/healthz /api/ai/healthz; do
  printf "%-28s " "$p"
  strict_curl -sS --http2 -I -H "Host: $HOST" "https://$HOST$p" 2>/dev/null | head -n1 || echo "fail"
done

echo "== HTTP/3 (--http3-only) =="
for p in /api/healthz /api/ai/healthz; do
  printf "%-28s " "$p"
  strict_http3_curl -sS -I -H "Host: $HOST" "https://$HOST$p" 2>/dev/null | head -n1 || echo "skip/fail"
done

echo ""
echo "Done."
