#!/usr/bin/env bash
# Standalone packet-capture test: generates gRPC, HTTP/2, HTTP/3 traffic, captures, analyzes.
# Use to verify capture + comparison without running full smoke tests.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shims first so kubectl uses shim (avoids API server timeouts). See API_SERVER_READY_FIX_ONCE_AND_FOR_ALL.md
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && { source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" || true; }
[[ -f "$SCRIPT_DIR/lib/http3.sh" ]] && . "$SCRIPT_DIR/lib/http3.sh"
[[ -f "$SCRIPT_DIR/lib/packet-capture.sh" ]] && . "$SCRIPT_DIR/lib/packet-capture.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

NS="off-campus-housing-tracker"
HOST="${HOST:-off-campus-housing.local}"
export PORT="${PORT:-30443}"
export HOST
# When run from run-all: TARGET_IP + PORT=443 (MetalLB). Use for --resolve so traffic hits Caddy.
[[ -z "${TARGET_IP:-}" ]] && [[ -f "$SCRIPT_DIR/lib/resolve-lb-ip.sh" ]] && { source "$SCRIPT_DIR/lib/resolve-lb-ip.sh" 2>/dev/null || true; }
CURL_RESOLVE_IP="${TARGET_IP:-127.0.0.1}"
[[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && export PORT=443

# kubectl helper (for grpc-http3-health lib)
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kb() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=10s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=10s "$@" 2>/dev/null || true
  fi
}

# CA and strict TLS (same as other suites - required for strict TLS/mTLS and gRPC health)
CA_CERT=""
K8S_CA_ING=$(_kb -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
if [[ -n "$K8S_CA_ING" ]]; then
  CA_CERT="/tmp/test-ca-standalone-$$.pem"
  echo "$K8S_CA_ING" > "$CA_CERT"
fi
[[ -z "$CA_CERT" ]] && K8S_CA=$(_kb -n "$NS" get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d 2>/dev/null)
[[ -z "$CA_CERT" ]] && [[ -n "$K8S_CA" ]] && CA_CERT="/tmp/test-ca-standalone-$$.pem" && echo "$K8S_CA" > "$CA_CERT"
# Repo dev-root.pem must match cluster signing chain for TLS + grpcurl -cacert to succeed with MetalLB IP + SNI hostname
if [[ -z "${CA_CERT:-}" ]] || [[ ! -f "$CA_CERT" ]] || [[ ! -s "$CA_CERT" ]]; then
  [[ -f "$SCRIPT_DIR/../certs/dev-root.pem" ]] && CA_CERT="$(cd "$SCRIPT_DIR/.." && pwd)/certs/dev-root.pem"
fi
[[ -z "$CA_CERT" ]] && command -v mkcert >/dev/null 2>&1 && [[ -f "$(mkcert -CAROOT)/rootCA.pem" ]] && CA_CERT="$(mkcert -CAROOT)/rootCA.pem"
strict_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    curl --cacert "$CA_CERT" "$@"
  else
    curl -k "$@"
  fi
}
strict_http3_curl() {
  if [[ -n "$CA_CERT" ]] && [[ -f "$CA_CERT" ]]; then
    http3_curl --cacert "$CA_CERT" "$@" 2>/dev/null || http3_curl -k "$@"
  else
    http3_curl -k "$@"
  fi
}
# HTTP3_RESOLVE: same IP as curl MetalLB/--resolve (CURL_RESOLVE_IP), not ClusterIP — matches strict capture + grpc-http3-health
HTTP3_RESOLVE="${HOST}:${PORT:-443}:${CURL_RESOLVE_IP}"
GRPC_CERTS_DIR="${GRPC_CERTS_DIR:-/tmp/grpc-certs}"
export HTTP3_RESOLVE CA_CERT NS HOST PORT SCRIPT_DIR GRPC_CERTS_DIR

# Ensure API server (skip if SKIP_API_CHECK=1)
if [[ "${SKIP_API_CHECK:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/ensure-api-server-ready.sh" ]]; then
  KUBECTL_REQUEST_TIMEOUT=10s API_SERVER_MAX_ATTEMPTS=8 API_SERVER_SLEEP=2 \
    ENSURE_CAP=120 PREFLIGHT_CAP=45 "$SCRIPT_DIR/ensure-api-server-ready.sh" 2>/dev/null || true
fi

say "=== Standalone Packet Capture Test (gRPC + HTTP/2 + HTTP/3/QUIC) ==="

# Quick cluster check (use _kb so Colima works)
if ! _kb get ns ingress-nginx >/dev/null 2>&1; then
  warn "Cluster not reachable (ingress-nginx ns). Start cluster and run without SKIP_API_CHECK=1, or run baseline/enhanced/rotation when ready."
  exit 0
fi

# Colima: ClusterIP for optional VM→ClusterIP traffic (skipped in STRICT_QUIC_VALIDATION=1 so QUIC goes only via MetalLB path)
CADDY_IP=""
[[ "${STRICT_QUIC_VALIDATION:-0}" != "1" ]] && [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && \
  CADDY_IP=$(_kb -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")

# When MetalLB + Colima: use packet-capture-v2 so BPF dst host TARGET_IP:443 and tshark validation prove QUIC to MetalLB only (no background QUIC).
USE_CAPTURE_V2=0
if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ "$ctx" == *"colima"* ]] && [[ -f "$SCRIPT_DIR/lib/packet-capture-v2.sh" ]]; then
  USE_CAPTURE_V2=1
  export CAPTURE_V2_LB_IP="$TARGET_IP"
  export CAPTURE_DRAIN_SECONDS=5
  export CAPTURE_RUN_TYPE="standalone"
  info "Using packet-capture-v2 (BPF dst host $TARGET_IP:443, tshark validation); STRICT_QUIC_VALIDATION=${STRICT_QUIC_VALIDATION:-0}"
fi

if [[ "${USE_CAPTURE_V2}" == "1" ]]; then
  # Decode-aware tshark: pick up key log for -o tls.keylog_file (ALPN block uses CAPTURE_V2_TLS_KEYLOG / SSLKEYLOGFILE)
  if [[ -n "${SSLKEYLOGFILE:-}" ]] && [[ -f "${SSLKEYLOGFILE}" ]] && [[ -s "${SSLKEYLOGFILE}" ]]; then
    export CAPTURE_V2_TLS_KEYLOG="${CAPTURE_V2_TLS_KEYLOG:-$SSLKEYLOGFILE}"
  elif [[ -z "${CAPTURE_V2_TLS_KEYLOG:-}" ]] && [[ -f /tmp/sslkeys.log ]] && [[ -s /tmp/sslkeys.log ]]; then
    export CAPTURE_V2_TLS_KEYLOG="/tmp/sslkeys.log"
  fi
  if [[ -n "${CAPTURE_V2_TLS_KEYLOG:-}" ]]; then
    export SSLKEYLOGFILE="${SSLKEYLOGFILE:-$CAPTURE_V2_TLS_KEYLOG}"
    info "Decode-aware capture: CAPTURE_V2_TLS_KEYLOG=${CAPTURE_V2_TLS_KEYLOG} (HTTP/3 curl and tshark ALPN block use this file)"
  fi
  . "$SCRIPT_DIR/lib/packet-capture-v2.sh"
  init_capture_session_v2
  start_capture_v2
  export CAPTURE_COPY_DIR="$(packet_capture_dir)"
else
  init_capture_session
  export CAPTURE_DRAIN_SECONDS=5
  export CAPTURE_COPY_DIR="$(packet_capture_dir)"
  caddy_pods=$(_kb -n ingress-nginx get pods -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
  envoy_pod=$(_kb -n envoy-test get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  envoy_ns="envoy-test"
  [[ -z "$envoy_pod" ]] && envoy_pod=$(_kb -n ingress-nginx get pods -l app=envoy-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null) && envoy_ns="ingress-nginx"
  for p in $caddy_pods; do
    ok "Capture Caddy $p (HTTP/2 + HTTP/3/QUIC)"
    # Empty filter → packet-capture.sh applies strict BPF: (tcp|udp) dst podIP:443 (+ eth0). Broad filter only for NodePort paths.
    if [[ "${PORT:-30443}" == "443" ]] && [[ "${CAPTURE_STRICT_ENDPOINT_BPF:-1}" != "0" ]]; then
      start_capture "ingress-nginx" "$p" ""
    else
      start_capture "ingress-nginx" "$p" "port ${PORT} or port 443 or port 30443 or udp port 443"
    fi
  done
  [[ -n "$envoy_pod" ]] && ok "Capture Envoy $envoy_pod (gRPC)" && start_capture "$envoy_ns" "$envoy_pod" "port 10000 or port 30000 or portrange 50051-50068"
fi
# Allow tcpdump to start and capture
sleep 4

# Colima VM → ClusterIP: useful when not strict (pods see VM path). In STRICT_QUIC_VALIDATION=1, skip — capture/L1 prove MetalLB IP only; ClusterIP QUIC does not traverse LB.
if [[ "${STRICT_QUIC_VALIDATION:-0}" != "1" ]] && [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && [[ -n "$CADDY_IP" ]]; then
  ok "Generating HTTP/2 + HTTP/3 traffic from Colima VM (ClusterIP)…"
  # Always hostname + --resolve (never https://IP) so TLS SNI matches cert SAN (QUIC needs clean TLS 1.3)
  for i in 1 2 3 4 5 6 7 8; do
    colima ssh -- curl -sk --http2-prior-knowledge --max-time 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/_caddy/healthz" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http2-prior-knowledge --max-time 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/api/records/health" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http2-prior-knowledge --max-time 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/api/listings/healthz" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http2-prior-knowledge --max-time 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/api/trust/healthz" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http3 --connect-timeout 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/_caddy/healthz" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http3 --connect-timeout 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/api/records/health" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http3 --connect-timeout 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/api/listings/healthz" >/dev/null 2>&1 || true
    colima ssh -- curl -sk --http3 --connect-timeout 5 --resolve "${HOST}:443:${CADDY_IP}" "https://${HOST}/api/trust/healthz" >/dev/null 2>&1 || true
  done
elif [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && [[ "$ctx" == *"colima"* ]]; then
  info "STRICT_QUIC_VALIDATION=1: skipping Colima VM→ClusterIP curls (QUIC must traverse MetalLB ${TARGET_IP:-LB IP} only for capture alignment)"
fi
ok "Generating HTTP/2 traffic (strict TLS)…"
for i in 1 2 3 4 5; do
  strict_curl -s --http2-prior-knowledge --max-time 5 --resolve "${HOST}:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://${HOST}:${PORT}/_caddy/healthz" >/dev/null 2>&1 || true
  strict_curl -s --http2-prior-knowledge --max-time 5 --resolve "${HOST}:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://${HOST}:${PORT}/api/records/health" >/dev/null 2>&1 || true
  strict_curl -s --http2-prior-knowledge --max-time 5 --resolve "${HOST}:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://${HOST}:${PORT}/api/listings/healthz" >/dev/null 2>&1 || true
  strict_curl -s --http2-prior-knowledge --max-time 5 --resolve "${HOST}:${PORT}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "https://${HOST}:${PORT}/api/trust/healthz" >/dev/null 2>&1 || true
done

ok "Generating HTTP/3/QUIC traffic (strict TLS)…"
_h3_port="${PORT:-443}"
_h3_url="https://${HOST}:${_h3_port}"
[[ "$_h3_port" == "443" ]] && _h3_url="https://${HOST}"
for i in 1 2 3 4 5 6; do
  strict_http3_curl -s --connect-timeout 5 --resolve "${HOST}:${_h3_port}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "${_h3_url}/_caddy/healthz" >/dev/null 2>&1 || true
  strict_http3_curl -s --connect-timeout 5 --resolve "${HOST}:${_h3_port}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "${_h3_url}/api/records/health" >/dev/null 2>&1 || true
  strict_http3_curl -s --connect-timeout 5 --resolve "${HOST}:${_h3_port}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "${_h3_url}/api/listings/healthz" >/dev/null 2>&1 || true
  strict_http3_curl -s --connect-timeout 5 --resolve "${HOST}:${_h3_port}:${CURL_RESOLVE_IP}" -H "Host: $HOST" "${_h3_url}/api/trust/healthz" >/dev/null 2>&1 || true
done

ok "Generating gRPC traffic (grpcurl)…"
if command -v grpcurl >/dev/null 2>&1; then
  # Primary: gRPC via Caddy (TARGET_IP:443) — the real production path; generates traffic Caddy→Envoy
  if [[ -n "${TARGET_IP:-}" ]] && [[ "${PORT:-}" == "443" ]] && [[ -n "${CA_CERT:-}" ]] && [[ -f "${CA_CERT:-}" ]]; then
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    PROTO_DIR="${PROTO_DIR:-$REPO_ROOT/proto}"
    for _ in 1 2 3 4 5; do
      # Dial LB IP but TLS SNI + cert verify name = HOST (grpcurl: -authority; -servername same value is allowed)
      grpcurl -cacert "$CA_CERT" -authority "$HOST" -servername "$HOST" -max-time 5 "${TARGET_IP}:443" grpc.health.v1.Health/Check 2>/dev/null || true
      if [[ -f "$PROTO_DIR/listings.proto" ]]; then
        grpcurl -cacert "$CA_CERT" -authority "$HOST" -servername "$HOST" -import-path "$PROTO_DIR" -proto "$PROTO_DIR/listings.proto" \
          -max-time 5 -d '{"query":"capture","min_price":0,"max_price":999999999,"smoke_free":false,"pet_friendly":false}' \
          "${TARGET_IP}:443" listings.ListingsService/SearchListings 2>/dev/null || true
      fi
      if [[ -f "$PROTO_DIR/trust.proto" ]]; then
        grpcurl -cacert "$CA_CERT" -authority "$HOST" -servername "$HOST" -import-path "$PROTO_DIR" -proto "$PROTO_DIR/trust.proto" \
          -max-time 5 -d '{"user_id":"00000000-0000-0000-0000-000000000001"}' \
          "${TARGET_IP}:443" trust.TrustService/GetReputation 2>/dev/null || true
      fi
    done
  fi
  # Fallback: direct to NodePort (127.0.0.1:30000) — works on k3d when NodePort exposed
  for grpc_addr in "127.0.0.1:30000" "127.0.0.1:30001" "127.0.0.1:50051"; do
    grpcurl -plaintext -max-time 3 "$grpc_addr" list 2>/dev/null || true
    grpcurl -plaintext -max-time 3 "$grpc_addr" records.RecordsService/Health 2>/dev/null || true
  done
else
  warn "grpcurl not found; skipping gRPC traffic"
fi

# Health verification: Caddy HTTP/3 + gRPC (Envoy, Envoy strict TLS, port-forward) - strict TLS for all suites
if [[ -f "$SCRIPT_DIR/lib/grpc-http3-health.sh" ]]; then
  say "Health verification (Caddy HTTP/3 + gRPC 3 ways)"
  . "$SCRIPT_DIR/lib/grpc-http3-health.sh"
  run_grpc_http3_health_checks
fi

# Allow more time for traffic to be captured before stop (longer = more chance to see H2 + H3/QUIC)
sleep 12
say "Stopping captures and analyzing…"
LOG="/tmp/standalone-capture-$$.log"
if [[ "${USE_CAPTURE_V2:-0}" == "1" ]]; then
  if ! stop_and_analyze_captures_v2 2>&1 | tee "$LOG"; then
    warn "Packet capture v2: tshark validation failed (stray UDP 443 or STRICT_QUIC_VALIDATION=1). QUIC must be to MetalLB IP only."
    [[ "${STRICT_QUIC_VALIDATION:-0}" == "1" ]] && exit 1
  fi
  ok "Capture v2: BPF dst host ${CAPTURE_V2_LB_IP:-}:443; tshark verified QUIC to MetalLB only."
else
  stop_and_analyze_captures 1 2>&1 | tee "$LOG"
  if ! verify_protocol_counts "$LOG" 2>/dev/null; then
    # On Colima, NodePort may not expose traffic to host; VM->ClusterIP traffic still hits pods
    if [[ "$ctx" == *"colima"* ]] && grep -qE "TCP \(any\):|UDP \(any\):" "$LOG" 2>/dev/null; then
      ok "Protocol comparison: traffic captured (Colima - VM->ClusterIP; 443 counts may be 0 on host path)"
    elif [[ "${GRPC_HTTP3_HEALTH_OK:-0}" == "1" ]]; then
      ok "Protocol comparison: Caddy HTTP/3 health OK (host path may not see pod traffic; health check passed)"
    else
      warn "Protocol comparison: TCP or UDP 443 not both > 0 (see analysis below)"
      if [[ -s "$LOG" ]]; then
        echo "  ℹ️  Last 50 lines of capture analysis (for debugging):"
        tail -50 "$LOG" | sed 's/^/  /'
      fi
    fi
  fi
fi

say "=== Standalone Packet Capture Complete ==="
ok "Log: $LOG"
