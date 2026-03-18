#!/usr/bin/env bash
# Verify Caddy TLS: strict curl to /_caddy/healthz with dev-root-ca.
# Exit 0 if OK (HTTP 200, no curl 60). Exit 1 if curl 60 (CA/Caddy mismatch) or unreachable.
#
# Breakdown: Reads dev-root-ca from K8s (ingress-nginx or record-platform). Uses MetalLB LB IP:443
# when available, else NodePort (e.g. 30443). Curl with --cacert (no -k). Set PORT and CADDY_TARGET
# for port-forward (e.g. k3d: PORT=8443 CADDY_TARGET=127.0.0.1). On k3d prefer verify-caddy-strict-tls-in-cluster.sh to avoid port-forward.
# Run after reissue to ensure no curl exit 60 before suites.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS="${NS:-record-platform}"
HOST="${HOST:-record.local}"
CURL_BIN="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

# Prefer MetalLB LoadBalancer IP:443 when present; else NodePort (30443) with 127.0.0.1
PORT="${PORT:-30443}"
CADDY_TARGET=""   # empty = use 127.0.0.1:PORT; else "IP" for IP:443
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}
if [[ "$ctx" == "kind-h3-multi" ]]; then
  for p in 8445 8446 8444; do
    if curl -k -s --http2 --max-time 1 -H "Host: ${HOST}" "https://127.0.0.1:${p}/_caddy/healthz" >/dev/null 2>&1; then
      PORT=$p
      break
    fi
  done
  PORT="${PORT:-8445}"
else
  # MetalLB: use LoadBalancer external IP on port 443 when assigned (skip if user set CADDY_TARGET, e.g. port-forward on k3d)
  if [[ -z "${CADDY_TARGET:-}" ]]; then
    LB_IP=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    if [[ -n "$LB_IP" ]]; then
      CADDY_TARGET="$LB_IP"
      PORT=443
    else
      DETECTED=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "")
      [[ -n "$DETECTED" ]] && PORT="$DETECTED"
    fi
  fi
fi

# CA from K8s
CA_CERT=""
K8S_CA=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
[[ -z "$K8S_CA" ]] && K8S_CA=$(_kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA" ]]; then
  CA_CERT=$(mktemp 2>/dev/null) || CA_CERT="/tmp/verify-caddy-ca-$$.pem"
  echo "$K8S_CA" > "$CA_CERT"
else
  fail "No dev-root-ca secret; cannot verify strict TLS"
fi

out=$(mktemp 2>/dev/null) || out="/tmp/verify-caddy-$$.out"
trap 'rm -f "${CA_CERT:-}" "${out:-}"' EXIT

# Timeouts: avoid curl exit 28 (timeout) when using LB or cold start. Give QUIC/HTTP3 extra time.
_resolve_host="${CADDY_TARGET:-127.0.0.1}"
CURL_MAX_TIME="${CURL_MAX_TIME:-25}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-10}"

# --- HTTP/2 health (strict TLS, no -k) ---
rc=0
code=$("$CURL_BIN" --cacert "$CA_CERT" -sS -w "%{http_code}" -o "$out" --max-time "$CURL_MAX_TIME" --connect-timeout "$CURL_CONNECT_TIMEOUT" \
  --http2 --resolve "${HOST}:${PORT}:${_resolve_host}" -H "Host: $HOST" \
  "https://${HOST}:${PORT}/_caddy/healthz" 2>/dev/null) || rc=$?
[[ -z "$code" ]] && code="000"
if [[ "$rc" -eq 60 ]]; then
  fail "curl exit 60: CA does not match Caddy. Run: pnpm run reissue"
fi
if [[ "$rc" -eq 28 ]]; then
  fail "Caddy HTTP/2 health check timed out (exit 28). Increase CURL_MAX_TIME/CURL_CONNECT_TIMEOUT or check LB reachability."
fi
if [[ "$rc" -ne 0 ]]; then
  fail "Caddy HTTP/2 health check failed (exit $rc)"
fi
if [[ "$code" != "200" ]]; then
  fail "Caddy HTTP/2 health returned $code (expected 200)"
fi
ok "Caddy HTTP/2 strict TLS OK (200, no exit 28/60)"

# --- HTTP/3 health (optional: same CA, generous timeout to avoid exit 28) ---
if "$CURL_BIN" --version 2>/dev/null | grep -qi "nghttp3\|quic"; then
  rc3=0
  code3=$("$CURL_BIN" --cacert "$CA_CERT" -sS -w "%{http_code}" -o "$out" --max-time "$CURL_MAX_TIME" --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --http3-only --resolve "${HOST}:${PORT}:${_resolve_host}" -H "Host: $HOST" \
    "https://${HOST}:${PORT}/_caddy/healthz" 2>/dev/null) || rc3=$?
  [[ -z "$code3" ]] && code3="000"
  if [[ "$rc3" -eq 28 ]]; then
    fail "Caddy HTTP/3 health check timed out (exit 28). Give QUIC time or increase CURL_MAX_TIME."
  fi
  if [[ "$rc3" -ne 0 ]] || [[ "$code3" != "200" ]]; then
    fail "Caddy HTTP/3 health check failed (exit $rc3, HTTP $code3)"
  fi
  ok "Caddy HTTP/3 strict TLS OK (200, no exit 28)"
else
  warn "curl does not support HTTP/3; skipping HTTP/3 health check"
fi
