#!/usr/bin/env bash
# One entrypoint: packet capture (standalone) → analyze pcaps with repo Python/tshark tools.
# Requires: cluster, TARGET_IP for strict QUIC (same as test-packet-capture-standalone.sh), optional tshark.
#
# Env:
#   NETWORK_CC_OUT   — directory for analysis JSON/text (default: bench_logs/forensics/network-cc-<stamp>)
#   SKIP_CAPTURE=1   — only analyze existing pcaps under NETWORK_CC_PCAPI_DIR or latest /tmp/packet-captures-*
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${NETWORK_CC_OUT:-$REPO_ROOT/bench_logs/forensics/network-cc-$STAMP}"
mkdir -p "$OUT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== NETWORK COMMAND CENTER ==="
echo "artifacts: $OUT"

find_latest_pcap_dir() {
  local d
  d=$(ls -td /tmp/packet-captures-* 2>/dev/null | head -1 || true)
  [[ -n "$d" ]] && echo "$d"
}

pick_largest_pcap() {
  local dir="$1"
  [[ -z "$dir" ]] || [[ ! -d "$dir" ]] && return 1
  local best="" bestz=0
  local f
  for f in "$dir"/*.pcap; do
    [[ -f "$f" ]] || continue
    local z
    z=$(wc -c <"$f" 2>/dev/null | tr -d ' ' || echo 0)
    [[ "$z" -gt 256 ]] && [[ "$z" -gt "$bestz" ]] && { bestz=$z; best=$f; }
  done
  [[ -n "$best" ]] && echo "$best"
}

if [[ "${SKIP_CAPTURE:-0}" != "1" ]]; then
  say "1. Capturing (test-packet-capture-standalone.sh)…"
  if ! bash "$SCRIPT_DIR/test-packet-capture-standalone.sh" 2>&1 | tee "$OUT/capture-run.log"; then
    warn "Capture script exited non-zero; continuing to best-effort analyze (strict QUIC may fail without TARGET_IP)."
  fi
else
  say "1. SKIP_CAPTURE=1 — skipping capture"
fi

PCAP_DIR="${NETWORK_CC_PCAPI_DIR:-}"
[[ -z "$PCAP_DIR" ]] && PCAP_DIR="$(find_latest_pcap_dir || true)"
PCAP="$(pick_largest_pcap "$PCAP_DIR" || true)"

if [[ -z "$PCAP" ]] || [[ ! -f "$PCAP" ]]; then
  warn "No suitable .pcap found (looked in ${PCAP_DIR:-/tmp/packet-captures-*}). Set NETWORK_CC_PCAPI_DIR or run capture without SKIP_CAPTURE."
  exit 0
fi

ok "Using pcap: $PCAP (copy)"
cp -f "$PCAP" "$OUT/$(basename "$PCAP")"

PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python

say "2. QUIC / loss metrics (analyze_quic_metrics.py)…"
"$PY" "$SCRIPT_DIR/lib/analyze_quic_metrics.py" "$PCAP" | tee "$OUT/quic-metrics.json" || true

say "3. QUIC loss analyzer (quic_loss_analyzer.py)…"
"$PY" "$SCRIPT_DIR/lib/quic_loss_analyzer.py" "$PCAP" | tee "$OUT/quic-loss.json" || true

say "4. TLS handshake timing (tshark → analyze_tls_timing.py)…"
TLS_TXT="$OUT/tls-handshake-fields.txt"
if command -v tshark >/dev/null 2>&1; then
  tshark -r "$PCAP" -Y "tls.handshake.type==1 || tls.handshake.type==2" \
    -T fields -e frame.time_epoch -e tls.handshake.type -e tls.stream 2>/dev/null > "$TLS_TXT" || true
  if [[ -s "$TLS_TXT" ]]; then
    "$PY" "$SCRIPT_DIR/lib/analyze_tls_timing.py" "$TLS_TXT" | tee "$OUT/tls-handshake-timing.json" || true
  else
    warn "No TLS handshake fields in pcap (QUIC-only capture is normal)."
  fi
else
  warn "tshark not installed; skip TLS handshake extract."
fi

say "5. HTTP/3 frame summary (http3_frame_inspector.py)…"
if [[ -f "$SCRIPT_DIR/lib/http3_frame_inspector.py" ]]; then
  "$PY" "$SCRIPT_DIR/lib/http3_frame_inspector.py" "$PCAP" | tee "$OUT/http3-frames.json" || true
else
  warn "http3_frame_inspector.py missing"
fi

say "6. TCP RST / retransmissions / TLS alerts (tshark → pcap_transport_summary.py)…"
if [[ -f "$SCRIPT_DIR/lib/pcap_transport_summary.py" ]]; then
  "$PY" "$SCRIPT_DIR/lib/pcap_transport_summary.py" "$PCAP" | tee "$OUT/transport-summary.json" || true
else
  warn "pcap_transport_summary.py missing"
fi

say "=== NETWORK COMMAND CENTER DONE ==="
ok "Outputs under: $OUT"
