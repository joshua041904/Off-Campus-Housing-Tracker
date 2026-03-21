#!/usr/bin/env bash
# Master transport / TLS / QUIC analysis runner — chains scripts/lib helpers after captures.
# For 0-RTT vs 1-RTT: QUIC 0-RTT shows early app data after first connection resumes session;
# use SSLKEYLOGFILE with Wireshark/tshark to decrypt and compare Initial vs 0-RTT flight timing.
# See docs/TESTING_PROTOCOLS.md and scripts/lib/COHERENT_ANALYSIS.md
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$ROOT/scripts/lib"
OUT_DIR="${TRANSPORT_ANALYSIS_OUT:-$ROOT/.cache/transport-analysis}"
mkdir -p "$OUT_DIR"

echo "== master-transport-analysis =="
echo "OUT_DIR=$OUT_DIR"
echo "Tip: export SSLKEYLOGFILE=$OUT_DIR/sslkeylog.txt when running curl/chrome for decryptable pcaps."
echo ""

TLS_FIELDS="${TLS_FIELDS:-$OUT_DIR/tls-handshake-fields.txt}"
if [[ -f "$TLS_FIELDS" ]]; then
  echo "-- analyze_tls_timing.py ($TLS_FIELDS)"
  python3 "$LIB/analyze_tls_timing.py" "$TLS_FIELDS" | tee "$OUT_DIR/tls-handshake-summary.json" || true
else
  echo "(skip) No TLS field dump at TLS_FIELDS=$TLS_FIELDS — produce with tshark per analyze_tls_timing.py header"
fi

for f in quic_loss_analyzer.py transport_validator.py compare-transport.py; do
  if [[ -f "$LIB/$f" ]]; then
    echo "-- $f (run with -h if supported)"
    python3 "$LIB/$f" --help 2>/dev/null | head -n 5 || true
  fi
done

echo ""
echo "Done. Layer pcaps + sslkeylog, then re-run with TLS_FIELDS / QUIC inputs set."
