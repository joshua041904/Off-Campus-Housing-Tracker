#!/usr/bin/env bash
# Optional packet capture: ./scripts/run-suite-with-packet-capture.sh "$0" "$@"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/kubectl-helper.sh" ]] && . "$SCRIPT_DIR/lib/kubectl-helper.sh"
_kubectl() { kctl "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"; }

HOST="${HOST:-off-campus-housing.test}"
BOOKING_K8S_NS="${BOOKING_K8S_NS:-off-campus-housing-tracker}"
LB_IP="${TARGET_IP:-$(_kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")}"
[[ -z "$LB_IP" ]] && { echo "❌ No MetalLB IP found for caddy-h3"; exit 1; }

CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"
[[ -f "$CA_CERT" ]] || { echo "❌ CA cert missing: $CA_CERT"; exit 1; }

HCURL="${CURL_BIN:-/opt/homebrew/opt/curl/bin/curl}"
[[ -x "$HCURL" ]] || HCURL="curl"

GRPC_CERTS_DIR="${GRPC_CERTS_DIR:-/tmp/grpc-certs-booking-$(date +%s)}"
mkdir -p "$GRPC_CERTS_DIR"
for _sec in och-service-tls service-tls; do
  _b64_crt="$(_kubectl -n "$BOOKING_K8S_NS" get secret "$_sec" -o jsonpath='{.data.tls\.crt}' 2>/dev/null)"
  _b64_key="$(_kubectl -n "$BOOKING_K8S_NS" get secret "$_sec" -o jsonpath='{.data.tls\.key}' 2>/dev/null)"
  _b64_ca="$(_kubectl -n "$BOOKING_K8S_NS" get secret "$_sec" -o jsonpath='{.data.ca\.crt}' 2>/dev/null)"
  if [[ -n "$_b64_crt" ]] && [[ -n "$_b64_key" ]]; then
    printf '%s' "$_b64_crt" | base64 -d > "$GRPC_CERTS_DIR/tls.crt"
    printf '%s' "$_b64_key" | base64 -d > "$GRPC_CERTS_DIR/tls.key"
    [[ -n "$_b64_ca" ]] && printf '%s' "$_b64_ca" | base64 -d > "$GRPC_CERTS_DIR/ca.crt" || : > "$GRPC_CERTS_DIR/ca.crt"
    break
  fi
done

say(){ printf "\n\033[1m%s\033[0m\n" "$*"; }
ok(){ echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

BASE="https://${HOST}"
RESOLVE=(--resolve "${HOST}:443:${LB_IP}")
H3_MAX_TIME="${H3_MAX_TIME:-25}"
H3_CONNECT="${H3_CONNECT:-8}"
H3_RETRIES="${H3_RETRIES:-4}"
H3_SLEEP="${H3_SLEEP:-4}"

say "Booking protocol test (MetalLB only): HTTP/2 + HTTP/3 + gRPC TLS/mTLS"
echo "ℹ️  LB IP: ${LB_IP}"

HTTP2_CODE="$("$HCURL" --http2 --cacert "$CA_CERT" "${RESOLVE[@]}" -sS -o /tmp/booking-h2-health.json -w "%{http_code}" "${BASE}/api/booking/healthz" || true)"
[[ "$HTTP2_CODE" == "200" ]] || fail "HTTP/2 health failed (code=${HTTP2_CODE})"
ok "HTTP/2 booking health OK"

if "$HCURL" --help all 2>/dev/null | grep -q -- "--http3-only"; then
  HTTP3_CODE=""
  for _attempt in $(seq 1 "$H3_RETRIES"); do
    HTTP3_CODE="$("$HCURL" --http3-only --cacert "$CA_CERT" "${RESOLVE[@]}" \
      --max-time "$H3_MAX_TIME" --connect-timeout "$H3_CONNECT" \
      -sS -o /tmp/booking-h3-health.json -w "%{http_code}" "${BASE}/api/booking/healthz" || true)"
    [[ "$HTTP3_CODE" == "200" ]] && break
    sleep "$H3_SLEEP"
  done
  [[ "$HTTP3_CODE" == "200" ]] || fail "HTTP/3 health failed (code=${HTTP3_CODE})"
  ok "HTTP/3 booking health OK"
else
  warn "curl without --http3-only; skipping explicit HTTP/3 probe"
fi

_EMAIL_TS="$(date +%s)"
EMAIL="booking-proto-${_EMAIL_TS}@example.com"
PASS="TestPass123!"
LISTING_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
START_DATE="$(python3 -c 'from datetime import date,timedelta; d=date.today()+timedelta(days=40); print(d.isoformat())')"
END_DATE="$(python3 -c 'from datetime import date,timedelta; d=date.today()+timedelta(days=70); print(d.isoformat())')"
TOKEN="$("$HCURL" --http2 --cacert "$CA_CERT" "${RESOLVE[@]}" -sS -H "content-type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" "${BASE}/api/auth/register" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')"
[[ -n "$TOKEN" ]] || fail "auth token acquisition failed"
ok "Auth register/token OK"

CREATE_CODE="$("$HCURL" --http2 --cacert "$CA_CERT" "${RESOLVE[@]}" -sS -o /tmp/booking-create.json -w "%{http_code}" \
  -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" \
  -d "{\"listingId\":\"${LISTING_ID}\",\"startDate\":\"${START_DATE}\",\"endDate\":\"${END_DATE}\"}" \
  "${BASE}/api/booking/create" || true)"
[[ "$CREATE_CODE" == "201" ]] || fail "booking create over HTTP/2 failed (code=${CREATE_CODE})"
BOOKING_ID="$(python3 - <<'PY'
import json
print(json.load(open('/tmp/booking-create.json')).get('id',''))
PY
)"
[[ -n "$BOOKING_ID" ]] || fail "booking create missing id"
ok "Booking create over HTTP/2 OK (${BOOKING_ID})"

CONFIRM_CODE="$("$HCURL" --http2 --cacert "$CA_CERT" "${RESOLVE[@]}" -sS -o /tmp/booking-confirm.json -w "%{http_code}" \
  -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" \
  -d "{\"bookingId\":\"${BOOKING_ID}\"}" "${BASE}/api/booking/confirm" || true)"
[[ "$CONFIRM_CODE" == "200" ]] || fail "booking confirm over HTTP/2 failed (code=${CONFIRM_CODE})"
ok "Booking confirm over HTTP/2 OK"

BOOKING_GRPC_SNI="${BOOKING_GRPC_SNI:-booking-service.off-campus-housing-tracker.svc.cluster.local}"
if _kubectl -n "$BOOKING_K8S_NS" exec deploy/booking-service -- /usr/local/bin/grpc-health-probe \
  -addr=127.0.0.1:50063 -service=booking.BookingService -tls \
  -tls-ca-cert=/etc/certs/ca.crt -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key \
  -tls-server-name="$BOOKING_GRPC_SNI" -connect-timeout=15s -rpc-timeout=10s >/tmp/booking-grpc-health.out 2>/tmp/booking-grpc-health.err; then
  ok "gRPC TLS/mTLS health (grpc-health-probe in booking pod, :50063) OK"
else
  warn "gRPC TLS/mTLS health probe in booking pod failed (see /tmp/booking-grpc-health.err)"
fi

# Edge: Caddy → Envoy → booking (proves /booking.BookingService/* routing, not only in-pod probe).
# After CA/service-tls rotation, Envoy may need a moment to re-handshake; refresh certs and retry.
BOOKING_PROTO="$REPO_ROOT/proto/booking.proto"
if command -v grpcurl >/dev/null 2>&1 && [[ -f "$BOOKING_PROTO" ]]; then
  for _sec in och-service-tls service-tls; do
    _b64_crt="$(_kubectl -n "$BOOKING_K8S_NS" get secret "$_sec" -o jsonpath='{.data.tls\.crt}' 2>/dev/null)"
    _b64_key="$(_kubectl -n "$BOOKING_K8S_NS" get secret "$_sec" -o jsonpath='{.data.tls\.key}' 2>/dev/null)"
    if [[ -n "$_b64_crt" ]] && [[ -n "$_b64_key" ]]; then
      printf '%s' "$_b64_crt" | base64 -d > "$GRPC_CERTS_DIR/tls.crt"
      printf '%s' "$_b64_key" | base64 -d > "$GRPC_CERTS_DIR/tls.key"
      break
    fi
  done
fi
if command -v grpcurl >/dev/null 2>&1 && [[ -f "$BOOKING_PROTO" ]] && [[ -f "$GRPC_CERTS_DIR/tls.crt" ]] && [[ -f "$GRPC_CERTS_DIR/tls.key" ]]; then
  _edge_ok=0
  _edge_restarted=0
  for _attempt in 1 2 3 4; do
    set +e
    _edge_out="$(grpcurl -cacert "$CA_CERT" -cert "$GRPC_CERTS_DIR/tls.crt" -key "$GRPC_CERTS_DIR/tls.key" \
      -authority "$HOST" -servername "$HOST" \
      -import-path "$REPO_ROOT/proto" -proto "$BOOKING_PROTO" -max-time 20 \
      -d '{"booking_id":"00000000-0000-0000-0000-000000000001"}' \
      "${LB_IP}:443" booking.BookingService/GetBooking 2>&1)"
    _edge_rc=$?
    set -e
    if echo "$_edge_out" | grep -qiE 'NotFound|NOT_FOUND|Code: 5|no rows|not found'; then
      ok "gRPC edge (grpcurl → :443) reached booking service (NotFound for dummy id is OK)"
      _edge_ok=1
      break
    fi
    if echo "$_edge_out" | grep -qiE 'SERVING|booking_id|listing_id'; then
      ok "gRPC edge (grpcurl → :443) booking GetBooking response OK"
      _edge_ok=1
      break
    fi
    if [[ "$_edge_rc" == "0" ]] && [[ -n "$_edge_out" ]]; then
      ok "gRPC edge (grpcurl → :443) completed (rc=0)"
      _edge_ok=1
      break
    fi
    if [[ "$_edge_restarted" -eq 0 ]] && echo "$_edge_out" | grep -qiE 'CERTIFICATE_VERIFY_FAILED|TLS_error|Unavailable'; then
      _kubectl -n "$BOOKING_K8S_NS" rollout restart deployment/booking-service >/dev/null 2>&1 || true
      _kubectl -n envoy-test rollout restart deployment/envoy-test >/dev/null 2>&1 || true
      _edge_restarted=1
      sleep 20
    else
      sleep 8
    fi
  done
  if [[ "$_edge_ok" != "1" ]]; then
    warn "gRPC edge grpcurl did not show expected booking response (rc=${_edge_rc}); tail: $(echo "$_edge_out" | tail -n 3)"
  fi
  unset _edge_out _edge_rc _edge_ok
else
  warn "Skipping edge grpcurl (need grpcurl, $BOOKING_PROTO, and extracted service TLS in $GRPC_CERTS_DIR)"
fi

ok "Booking MetalLB protocol test complete"
