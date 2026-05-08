#!/usr/bin/env bash
# Preflight Phase 1 — controlled L1 capture window: minimal HTTP/2 + HTTP/3 + gRPC + Jaeger seed,
# then v6/v7 forensics on a quiet pcap (no Playwright / no long matrix capture).
#
# Requires: Colima + kubectl context, MetalLB TARGET_IP, NODE_EXTRA_CA_CERTS (or certs/dev-root.pem).
# Env:
#   QUIC_TUNE_UDP_BUFFERS=1 (default) — best-effort Colima VM sysctl for UDP socket limits.
#   L1 BPF: default is wide UDP (udp port 443) + TCP to LB — QUIC often has no LB IP in outer IPv4 after DNAT on node capture.
#   PREFLIGHT_PHASE1_STRICT_UDP_BPF=1 — set CAPTURE_V2_L1_UDP_HOST_MATCH (udp port 443 and host LB); optional noise cut, may miss QUIC.
#   Legacy: PREFLIGHT_PHASE1_LOOSE_UDP_BPF=0 — same as strict host match on UDP (old opt-out of loose).
#   CAPTURE_WARMUP_SECONDS / CAPTURE_DRAIN_SECONDS — passed through to packet-capture-v2.
#   PREFLIGHT_RUN_DIR — optional; used for sslkeylog path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
[[ -f "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" ]] && source "$SCRIPT_DIR/lib/ensure-kubectl-shim.sh" 2>/dev/null || true
[[ -f "$SCRIPT_DIR/lib/http3.sh" ]] && source "$SCRIPT_DIR/lib/http3.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

HOST="${HOST:-off-campus-housing.test}"
export PORT=443
export STRICT_QUIC_VALIDATION=1
export CAPTURE_NODE_ONLY=1
export CAPTURE_RUN_TYPE="preflight-phase1"

[[ -n "${TARGET_IP:-}" ]] || { echo "preflight-controlled-transport-otel-prove: TARGET_IP required" >&2; exit 1; }
[[ "$HOST" =~ ^[0-9.]+$ ]] && { echo "preflight-controlled-transport-otel-prove: HOST must be a hostname, not an IP" >&2; exit 1; }

CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
[[ -s "$CA" ]] || { echo "preflight-controlled-transport-otel-prove: missing CA $CA" >&2; exit 1; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
[[ "$ctx" == *"colima"* ]] || { echo "preflight-controlled-transport-otel-prove: Colima kubectl context required (got: ${ctx:-empty})" >&2; exit 1; }
command -v colima >/dev/null 2>&1 || { echo "preflight-controlled-transport-otel-prove: colima not on PATH" >&2; exit 1; }

export CAPTURE_V2_LB_IP="${CAPTURE_V2_LB_IP:-$TARGET_IP}"
unset CAPTURE_V2_L1_UDP_HOST_MATCH 2>/dev/null || true
if [[ "${PREFLIGHT_PHASE1_STRICT_UDP_BPF:-0}" == "1" ]] || [[ "${PREFLIGHT_PHASE1_LOOSE_UDP_BPF:-1}" == "0" ]]; then
  export CAPTURE_V2_L1_UDP_HOST_MATCH=1
fi

if [[ "${QUIC_TUNE_UDP_BUFFERS:-1}" == "1" ]]; then
  say "Phase 1: Colima VM UDP buffer sysctl (best-effort; QUIC_TUNE_UDP_BUFFERS=0 to skip)"
  colima ssh -- sudo sysctl -w net.core.rmem_max=26214400 2>/dev/null || warn "rmem_max sysctl skipped"
  colima ssh -- sudo sysctl -w net.core.wmem_max=26214400 2>/dev/null || warn "wmem_max sysctl skipped"
fi

_kl_dir="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs}"
mkdir -p "$_kl_dir/transport-forensics" 2>/dev/null || true
export SSLKEYLOGFILE="${SSLKEYLOGFILE:-$_kl_dir/transport-forensics/preflight-phase1.sslkeylog}"
: >"$SSLKEYLOGFILE" 2>/dev/null || touch "$SSLKEYLOGFILE" 2>/dev/null || true
export CAPTURE_V2_TLS_KEYLOG="$SSLKEYLOGFILE"

say "Phase 1: starting Colima L1 capture (STRICT_QUIC_VALIDATION=1, UDP+LB host match=${CAPTURE_V2_L1_UDP_HOST_MATCH:-off})"
# shellcheck source=lib/packet-capture-v2.sh
source "$SCRIPT_DIR/lib/packet-capture-v2.sh"
init_capture_session_v2
start_capture_v2

sleep 2

_http2_ver=""
_http3_ver=""
_http2_ok=0
_http3_ok=0

say "Phase 1: single HTTP/2 (ALPN) request"
_http2_ver="$(curl -sS --cacert "$CA" --http2 --connect-timeout 10 --max-time 25 \
  --resolve "${HOST}:443:${TARGET_IP}" "https://${HOST}/_caddy/healthz" -o /dev/null -w '%{http_version}' 2>/dev/null || echo "0")"
[[ "${_http2_ver:-}" == "2" ]] && _http2_ok=1

say "Phase 1: single HTTP/3-only request (one retry)"
for _try in 1 2; do
  _http3_ver="$(http3_curl --cacert "$CA" -sS --http3-only --connect-timeout 10 --max-time 25 \
    --resolve "${HOST}:443:${TARGET_IP}" "https://${HOST}/_caddy/healthz" -o /dev/null -w '%{http_version}' 2>/dev/null || echo "0")"
  [[ "${_http3_ver:-}" == "3" ]] && break
  [[ "$_try" == "1" ]] && sleep 1
done
[[ "${_http3_ver:-}" == "3" ]] && _http3_ok=1

export CAPTURE_V2_EXPECT_HTTP_VERSION=3
export CAPTURE_V2_HTTP_VERSION="${_http3_ver:-0}"
export STRICT_CURL_H3_OK=0
[[ "$_http3_ok" == "1" ]] && export STRICT_CURL_H3_OK=1

say "Phase 1: single gRPC Health/Check (edge :443)"
if command -v grpcurl >/dev/null 2>&1; then
  grpcurl -cacert "$CA" -authority "$HOST" -max-time 15 "${TARGET_IP}:443" grpc.health.v1.Health/Check >/dev/null 2>&1 || warn "grpcurl Health/Check failed (non-fatal for pcap)"
else
  warn "grpcurl not on PATH — skipping gRPC probe"
fi

if [[ -f "$SCRIPT_DIR/seed-jaeger-via-edge-health.sh" ]] && [[ -s "$CA" ]]; then
  say "Phase 1: minimal Jaeger seed (1 round, OTLP batch lag buffer)"
  NODE_EXTRA_CA_CERTS="$CA" SEED_JAEGER_ROUNDS=1 SEED_JAEGER_SLEEP_SEC=0 \
    E2E_API_BASE="${E2E_API_BASE:-https://${HOST}}" \
    bash "$SCRIPT_DIR/seed-jaeger-via-edge-health.sh" 2>/dev/null || warn "seed-jaeger-via-edge-health had issues (non-fatal)"
  sleep 3
fi

say "Phase 1: stopping capture and running v6/v7 forensics"
if ! stop_and_analyze_captures_v2; then
  echo "preflight-controlled-transport-otel-prove: stop_and_analyze_captures_v2 failed" >&2
  exit 1
fi

_cap="$(packet_capture_dir)"
printf '%s\n' "$_cap" >"$REPO_ROOT/bench_logs/.preflight-phase1-capture-dir"
printf '%s\n' "$_cap" >"$REPO_ROOT/bench_logs/.last-transport-quic-prove-dir"

if [[ -f "$_cap/transport-summary-v7.json" ]] && command -v jq >/dev/null 2>&1; then
  _tmp="$(mktemp)"
  jq \
    --argjson h2 "$_http2_ok" \
    --argjson h3 "$_http3_ok" \
    --arg h2v "${_http2_ver:-}" \
    --arg h3v "${_http3_ver:-}" \
    '. + {
      protocol_proof: {
        http2_seen: $h2,
        http3_seen: $h3,
        curl_http_version_h2: $h2v,
        curl_http_version_h3: $h3v,
        alpn_values: ([] | if $h2 == 1 then . + ["h2"] else . end | if $h3 == 1 then . + ["h3"] else . end),
        capture_mode: "preflight-phase1-controlled-window"
      }
    }' "$_cap/transport-summary-v7.json" >"$_tmp" && mv "$_tmp" "$_cap/transport-summary-v7.json"
fi

ok "Phase 1 complete — capture dir: $_cap (marker: bench_logs/.preflight-phase1-capture-dir)"
exit 0
