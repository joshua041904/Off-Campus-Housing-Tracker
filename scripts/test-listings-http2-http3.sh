#!/usr/bin/env bash
# Listings: HTTP/2 + HTTP/3 health + search + optional gRPC health (in-cluster probe).
# Optional packet capture: ./scripts/run-suite-with-packet-capture.sh "$0" "$@"
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
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

if "$HCURL" --help all 2>/dev/null | grep -q -- "--http3-only"; then
  H3=""
  for _a in $(seq 1 4); do
    H3="$("$HCURL" --http3-only --cacert "$CA_CERT" "${RESOLVE[@]}" --max-time 25 --connect-timeout 8 \
      -sS -o /tmp/listings-h3.json -w "%{http_code}" "${BASE}/api/listings/healthz" || true)"
    [[ "$H3" == "200" ]] && break
    sleep 3
  done
  [[ "$H3" == "200" ]] || fail "HTTP/3 listings health failed ($H3)"
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
