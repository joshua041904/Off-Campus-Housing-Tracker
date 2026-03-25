#!/usr/bin/env bash
# Listings: HTTP/2 + HTTP/3 health + search + optional gRPC health (in-cluster probe).
# Optional packet capture: ./scripts/run-suite-with-packet-capture.sh "$0" "$@"
#
# HTTP/3 (QUIC) uses UDP to the same LB IP as HTTP/2 (TCP). curl (28) on connect usually means the QUIC handshake
# did not finish in time — often host→MetalLB UDP path (Colima: add route to pool subnet — docs/RUN-PREFLIGHT.md),
# macOS ngtcp2 GSO (we default NGTCP2_ENABLE_GSO=0), or transient load. Tune LISTINGS_H3_CONNECT_TIMEOUT / retries.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
# Avoid sendmsg EIO / flaky QUIC on macOS Homebrew curl + ngtcp2 (same as verify-metallb / http3.sh).
export NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}"
[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"
_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"; }

HOST="${HOST:-off-campus-housing.test}"
NS="${LISTINGS_K8S_NS:-off-campus-housing-tracker}"
LB_IP="${TARGET_IP:-$(_kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")}"
[[ -z "$LB_IP" ]] && { echo "❌ No MetalLB IP for caddy-h3"; exit 1; }

CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"
[[ -f "$CA_CERT" ]] || { echo "❌ CA missing: $CA_CERT"; exit 1; }
HCURL="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
[[ -x "$HCURL" ]] || HCURL="curl"
# QUIC connect often needs longer than TCP on Colima/MetalLB; 8s was tight under any jitter or post-k6 CPU.
LISTINGS_H3_CONNECT_TIMEOUT="${LISTINGS_H3_CONNECT_TIMEOUT:-18}"
LISTINGS_H3_MAX_TIME="${LISTINGS_H3_MAX_TIME:-35}"
LISTINGS_H3_RETRIES="${LISTINGS_H3_RETRIES:-5}"
LISTINGS_H3_RETRY_SLEEP="${LISTINGS_H3_RETRY_SLEEP:-4}"
BASE="https://${HOST}"
RESOLVE=(--resolve "${HOST}:443:${LB_IP}")

say(){ printf "\n\033[1m%s\033[0m\n" "$*"; }
ok(){ echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

say "Listings protocol test (MetalLB): HTTP/2 + HTTP/3 + gRPC health"
HTTP2_CODE="$("$HCURL" --http2 --cacert "$CA_CERT" "${RESOLVE[@]}" -sS -o /tmp/listings-h2.json -w "%{http_code}" "${BASE}/api/listings/healthz" || true)"
[[ "$HTTP2_CODE" == "200" ]] || fail "HTTP/2 listings health failed ($HTTP2_CODE)"
ok "HTTP/2 listings health OK"

_listings_h3_diagnose() {
  echo "⚠️  HTTP/3 (QUIC) failed but HTTP/2 to the same URL succeeded — this is almost always UDP to $LB_IP:443, not listings-service logic." >&2
  echo "   Try: docs/RUN-PREFLIGHT.md → 'Colima + MetalLB: host → LB IP and HTTP/3' (route to MetalLB pool subnet)." >&2
  echo "   Check: kubectl get svc caddy-h3 -n ingress-nginx -o wide   (TCP + UDP 443 on LoadBalancer)" >&2
  echo "   Env: NGTCP2_ENABLE_GSO=0 (default here), LISTINGS_H3_CONNECT_TIMEOUT=${LISTINGS_H3_CONNECT_TIMEOUT}s, LISTINGS_H3_RETRIES=${LISTINGS_H3_RETRIES}" >&2
  echo "   More: docs/VERIFY_VS_PREFLIGHT_HTTP3.md" >&2
}

if "$HCURL" --help all 2>/dev/null | grep -q -- "--http3-only"; then
  H3=""
  for _a in $(seq 1 "$LISTINGS_H3_RETRIES"); do
    H3="$(NGTCP2_ENABLE_GSO="${NGTCP2_ENABLE_GSO:-0}" "$HCURL" --http3-only --cacert "$CA_CERT" "${RESOLVE[@]}" \
      --max-time "$LISTINGS_H3_MAX_TIME" --connect-timeout "$LISTINGS_H3_CONNECT_TIMEOUT" \
      -sS -o /tmp/listings-h3.json -w "%{http_code}" "${BASE}/api/listings/healthz" || true)"
    [[ "$H3" == "200" ]] && break
    sleep "$LISTINGS_H3_RETRY_SLEEP"
  done
  if [[ "$H3" != "200" ]]; then
    _listings_h3_diagnose
    fail "HTTP/3 listings health failed ($H3)"
  fi
  ok "HTTP/3 listings health OK"
else
  warn "curl without --http3-only; skip H3"
fi

SEARCH_CODE="$("$HCURL" --http2 --cacert "$CA_CERT" "${RESOLVE[@]}" -sS -o /tmp/listings-search.json -w "%{http_code}" \
  "${BASE}/api/listings/search?q=studio" || true)"
[[ "$SEARCH_CODE" == "200" ]] || fail "HTTP/2 listings search failed ($SEARCH_CODE)"
ok "HTTP/2 public search OK"

if _kubectl -n "$NS" exec deploy/listings-service -- /usr/local/bin/grpc-health-probe \
  -addr=127.0.0.1:50062 -service=listings.ListingsService -tls \
  -tls-ca-cert=/etc/certs/ca.crt -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key \
  -tls-server-name="$HOST" -connect-timeout=10s -rpc-timeout=5s >/tmp/listings-grpc-health.out 2>/tmp/listings-grpc-health.err; then
  ok "gRPC TLS health (listings pod :50062) OK"
else
  warn "gRPC health probe in listings pod failed (see /tmp/listings-grpc-health.err)"
fi

ok "Listings MetalLB protocol test complete"
