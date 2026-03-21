#!/usr/bin/env bash
# Demo path: full preflight + all suites with MetalLB as the edge target, SSL key log for decode-aware
# capture (CAPTURE_V2_TLS_KEYLOG / SSLKEYLOGFILE), then optional standalone packet-capture test.
#
# Uses scripts/lib/resolve-lb-ip.sh after cluster has Caddy LoadBalancer IP.
# Analytical follow-ups: scripts/lib/COHERENT_ANALYSIS.md, generate-transport-summary-from-pcap.sh, compare-transport.py
#
# Env:
#   RUN_STANDALONE_PACKET_TEST=0  — skip test-packet-capture-standalone.sh after preflight
#   RUN_PGBENCH=0|1, RUN_FULL_LOAD=0|1 — passed through (defaults: 0 / 0 for faster demo)
#   METALLB_ENABLED=1 (default), K6_USE_METALLB=1 (default), STRICT_QUIC_VALIDATION=1 (default)
#   SSLKEYLOGFILE — override key log path (default: bench_logs/sslkeylog-<timestamp>.log)
#
# Usage:
#   ./scripts/run-demo-network-preflight.sh
#   make demo-network
set -euo pipefail
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

mkdir -p "$REPO_ROOT/bench_logs"
export SSLKEYLOGFILE="${SSLKEYLOGFILE:-$REPO_ROOT/bench_logs/sslkeylog-$(date +%Y%m%d-%H%M%S).log}"
: >> "$SSLKEYLOGFILE"
chmod 600 "$SSLKEYLOGFILE" 2>/dev/null || true
export CAPTURE_V2_TLS_KEYLOG="${CAPTURE_V2_TLS_KEYLOG:-$SSLKEYLOGFILE}"

# Colima + k3s is the supported local path for this demo (not k3d).
export REQUIRE_COLIMA="${REQUIRE_COLIMA:-1}"
export METALLB_USE_K3D="${METALLB_USE_K3D:-0}"
export METALLB_ENABLED="${METALLB_ENABLED:-1}"
export K6_USE_METALLB="${K6_USE_METALLB:-1}"
export HOST="${HOST:-off-campus-housing.local}"
export PORT="${PORT:-443}"
export STRICT_QUIC_VALIDATION="${STRICT_QUIC_VALIDATION:-1}"
export RUN_PGBENCH="${RUN_PGBENCH:-0}"
export RUN_FULL_LOAD="${RUN_FULL_LOAD:-0}"

if [[ -f "$SCRIPT_DIR/lib/resolve-lb-ip.sh" ]]; then
  # shellcheck source=/dev/null
  set -a && source "$SCRIPT_DIR/lib/resolve-lb-ip.sh" && set +a || true
fi

say "══ demo-network preflight ══"
echo "  METALLB_ENABLED=$METALLB_ENABLED PORT=$PORT HOST=$HOST"
echo "  SSLKEYLOGFILE=$SSLKEYLOGFILE"
echo "  CAPTURE_V2_TLS_KEYLOG=$CAPTURE_V2_TLS_KEYLOG"
echo "  RUN_PGBENCH=$RUN_PGBENCH RUN_FULL_LOAD=$RUN_FULL_LOAD"
if [[ -n "${TARGET_IP:-}" ]]; then
  ok "TARGET_IP=$TARGET_IP (k6 / suites should use MetalLB + SNI $HOST)"
else
  warn "TARGET_IP not set yet — normal before preflight assigns MetalLB to caddy-h3"
fi

say "→ run-preflight-scale-and-all-suites.sh"
if ! HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" "$SCRIPT_DIR/run-preflight-scale-and-all-suites.sh"; then
  warn "Preflight failed — skipping standalone packet test"
  exit 1
fi

if [[ "${RUN_STANDALONE_PACKET_TEST:-1}" != "1" ]]; then
  say "RUN_STANDALONE_PACKET_TEST≠1 — done"
  exit 0
fi

# Re-resolve LB IP after preflight (MetalLB may have just bound)
if [[ -f "$SCRIPT_DIR/lib/resolve-lb-ip.sh" ]]; then
  # shellcheck source=/dev/null
  set -a && source "$SCRIPT_DIR/lib/resolve-lb-ip.sh" && set +a || true
fi
if [[ -z "${TARGET_IP:-}" ]]; then
  warn "TARGET_IP still empty — skip test-packet-capture-standalone.sh (no MetalLB IP)"
  exit 0
fi

say "→ test-packet-capture-standalone.sh (gRPC + HTTP/2 + HTTP/3, sslkeylog + capture-v2 when Colima)"
export TARGET_IP PORT HOST SSLKEYLOGFILE CAPTURE_V2_TLS_KEYLOG
"$SCRIPT_DIR/test-packet-capture-standalone.sh" || warn "Standalone packet test exited non-zero"

say "Optional analytics: TRANSPORT_CAPTURES_DIR=/tmp/transport-captures \\"
say "  $SCRIPT_DIR/lib/generate-transport-summary-from-pcap.sh <node.pcap> preflight"
say "Docs: scripts/lib/COHERENT_ANALYSIS.md"
ok "demo-network finished"
