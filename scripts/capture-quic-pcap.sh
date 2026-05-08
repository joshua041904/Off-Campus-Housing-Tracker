#!/usr/bin/env bash
# Deterministic UDP/443 PCAP during curl HTTP/3 (optional Playwright) for QUIC forensics.
# Usage: ./scripts/capture-quic-pcap.sh <transport-forensics-dir>
# Env: HOST, SSL_CERT_FILE, QUIC_PCAP_FILTER, QUIC_PCAP_USE_SUDO, QUIC_PCAP_WITH_PLAYWRIGHT,
#      QUIC_CAPTURE_INTERFACE (default any), MIN_1RTT_PACKETS (default 1),
#      PREFLIGHT_STRICT_EXIT / QUIC_FORENSICS_STRICT — invariant failures exit 1 when set.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FO="${1:?usage: capture-quic-pcap.sh <transport-forensics-dir>}"
mkdir -p "$FO"
PCAP="$FO/quic-capture.pcap"
META="$FO/quic-capture-metadata.json"
H3LOG="$FO/curl-h3-verbose.log"
H2LOG="$FO/curl-h2-verbose.log"
TCPDUMP_ERR="$FO/tcpdump.stderr.log"
CA="${SSL_CERT_FILE:-${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}}"
HOST="${HOST:-off-campus-housing.test}"
URL="https://${HOST}/api/healthz"
FILTER="${QUIC_PCAP_FILTER:-udp and port 443}"
IFACE="${QUIC_CAPTURE_INTERFACE:-any}"
TCPDUMP_BIN="${QUIC_PCAP_TCPDUMP:-tcpdump}"
STRICT="${PREFLIGHT_STRICT_EXIT:-${QUIC_FORENSICS_STRICT:-0}}"

_started="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if ! command -v "$TCPDUMP_BIN" >/dev/null 2>&1; then
  node -e 'const fs=require("fs"),o=process.argv[1],d={started_at:process.argv[2],error:"tcpdump not found"};fs.writeFileSync(o,JSON.stringify(d,null,2)+"\n")' "$META" "$_started"
  [[ "$STRICT" != "1" ]] && exit 0
  exit 1
fi

TD_PID=""
if [[ "${QUIC_PCAP_USE_SUDO:-0}" == "1" ]]; then
  sudo -n "$TCPDUMP_BIN" -ni "$IFACE" -U -w "$PCAP" "$FILTER" 2>>"$TCPDUMP_ERR" &
  TD_PID=$!
else
  "$TCPDUMP_BIN" -ni "$IFACE" -U -w "$PCAP" "$FILTER" 2>>"$TCPDUMP_ERR" &
  TD_PID=$!
fi

sleep 0.7

_curl_h2=1
_curl_h3=1
if [[ -f "$CA" ]] && command -v curl >/dev/null 2>&1; then
  curl -sSI --http2 --max-time 20 --cacert "$CA" "$URL" >"${FO}/curl-h2-headers.txt" 2>>"$H2LOG" || _curl_h2=$?
  curl -v --http3 -sSI --max-time 25 --cacert "$CA" "$URL" >"${FO}/curl-h3-headers.txt" 2>>"$H3LOG" || _curl_h3=$?
else
  echo "missing curl or CA" >>"$H3LOG"
fi

if [[ "${QUIC_PCAP_WITH_PLAYWRIGHT:-0}" == "1" ]] && [[ -n "${JAEGER_QUERY_BASE:-}" ]]; then
  (
    cd "$REPO_ROOT/webapp"
    export NODE_EXTRA_CA_CERTS="$CA"
    export E2E_API_BASE="https://${HOST}"
    export PLAYWRIGHT_VERTICAL_STRICT=1 PLAYWRIGHT_STRICT_HTTP3=1
    pnpm exec playwright test --project=06-service-verticals --project=07-system-integrity
  ) >>"${FO}/playwright-during-pcap.log" 2>&1 || true
fi

if [[ -n "$TD_PID" ]] && kill -0 "$TD_PID" 2>/dev/null; then
  kill -INT "$TD_PID" 2>/dev/null || true
  wait "$TD_PID" 2>/dev/null || true
fi

sleep 0.3
_sz=0
[[ -f "$PCAP" ]] && _sz=$(wc -c <"$PCAP" | tr -d ' ')

_alpn=""
[[ -f "$H3LOG" ]] && _alpn=$(grep -iE 'ALPN|application protocol|h3|HTTP/3|using http/?3' "$H3LOG" | head -5 | tr '\n' ' ' | sed 's/  */ /g' || true)

_ended="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

node -e '
const fs = require("fs");
const doc = {
  started_at: process.argv[2],
  ended_at: process.argv[3],
  host: process.argv[4],
  url: process.argv[5],
  capture_filter: process.argv[6],
  pcap_path: process.argv[7],
  pcap_size_bytes: parseInt(process.argv[8], 10) || 0,
  curl_http2_exit: parseInt(process.argv[9], 10),
  curl_http3_exit: parseInt(process.argv[10], 10),
  curl_alpn_evidence: process.argv[11] || "",
};
fs.writeFileSync(process.argv[1], JSON.stringify(doc, null, 2) + "\n");
' "$META" "$_started" "$_ended" "$HOST" "$URL" "$FILTER" "$PCAP" "$_sz" "${_curl_h2:-1}" "${_curl_h3:-1}" "$_alpn"

if [[ "$_sz" -eq 0 ]]; then
  echo '{"valid":false,"error":"empty or missing pcap"}' >"$FO/quic-parse-report.json"
  export QUIC_FORENSICS_STRICT="$STRICT"
  python3 "$REPO_ROOT/scripts/lib/quic_invariants_emit.py" "$FO" || true
  [[ "$STRICT" != "1" ]] && exit 0
  exit 1
fi

export MIN_1RTT_PACKETS="${MIN_1RTT_PACKETS:-1}"
PARSE="$FO/quic-parse-report.json"
if command -v tshark >/dev/null 2>&1; then
  MIN_1RTT_PACKETS="$MIN_1RTT_PACKETS" python3 "$REPO_ROOT/scripts/lib/transport_validator.py" "$PCAP" --output "$PARSE" || true
else
  if ! PYTHONPATH="$REPO_ROOT/scripts/lib" python3 -m quic_command_center.cli "$PCAP" --output "$PARSE" 2>>"${FO}/dpkt-parse.log"; then
    echo '{"valid":false,"error":"dpkt parse failed; install tshark or pip install -r scripts/requirements-transport-forensics.txt"}' >"$PARSE"
  fi
fi

export QUIC_FORENSICS_STRICT="$STRICT"
python3 "$REPO_ROOT/scripts/lib/quic_invariants_emit.py" "$FO"
exit $?
