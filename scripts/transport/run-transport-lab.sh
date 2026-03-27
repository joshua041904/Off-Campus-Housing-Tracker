#!/usr/bin/env bash
# Orchestrates transport validation artifacts under bench_logs/transport-lab/ (or TRANSPORT_LAB_DIR).
# QUIC analysis uses repo scripts under scripts/lib/ (no unzip / bootstrap).
#
# Usage (repo root):
#   ./scripts/transport/run-transport-lab.sh
# Env:
#   SKIP_FULL_EDGE=1       — skip MetalLB/cluster curl suite (compose from existing JSON only)
#   SKIP_COLLAPSE_SMOKE=1  — skip k6 collapse smoke
#   TRANSPORT_LAB_QUIC=1   — capture UDP/443 pcap + run HTTP/3 k6 + scripts/lib analyzers (needs tcpdump; sudo often required)
#   KNEE_STEPS_JSON=path   — optional ramp steps JSON for knee_detection_v3.py (else stub knee.json)
#   CAPTURE_ENVOY_RETRIES=1 — pass through to per-service protocol tests
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB_DIR="$ROOT/scripts/lib"
REPO_ROOT="$ROOT"
export REPO_ROOT

OUT="${TRANSPORT_LAB_DIR:-$ROOT/bench_logs/transport-lab}"
QUIC_OUT="$OUT/quic"
export TRANSPORT_LAB_DIR="$OUT"

mkdir -p "$OUT/per-service"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }

_transport_quic_phase() {
  mkdir -p "$QUIC_OUT/analysis" "$QUIC_OUT/pcaps"
  local pcap="$QUIC_OUT/pcaps/quic_capture.pcap"
  local pcap_pid=""

  if command -v tcpdump >/dev/null 2>&1; then
    say "QUIC: starting capture (udp port 443)…"
    if sudo -n true 2>/dev/null; then
      sudo -n tcpdump -i any -nn udp port 443 -w "$pcap" >/dev/null 2>&1 &
      pcap_pid=$!
    else
      warn "TRANSPORT_LAB_QUIC: no passwordless sudo; attempting tcpdump without sudo (may fail on your OS)…"
      tcpdump -i any -nn udp port 443 -w "$pcap" >/dev/null 2>&1 &
      pcap_pid=$!
    fi
    sleep 1
  else
    warn "tcpdump not on PATH; using minimal pcap (analysis may report empty QUIC)"
    dd if=/dev/zero of="$pcap" bs=256 count=1 2>/dev/null || : >"$pcap"
  fi

  export SSL_CERT_FILE="${SSL_CERT_FILE:-$ROOT/certs/dev-root.pem}"
  local K6H3="${K6_HTTP3_BIN:-$ROOT/.k6-build/bin/k6-http3}"
  local H3SCPT="$ROOT/scripts/load/k6-gateway-health-http3.js"
  if [[ -x "$K6H3" ]] && [[ -f "$H3SCPT" ]]; then
    say "QUIC: HTTP/3 load (k6-http3)…"
    export K6_HTTP3_REQUIRE_MODULE=1
    export VUS="${TRANSPORT_LAB_QUIC_VUS:-10}"
    export DURATION="${TRANSPORT_LAB_QUIC_DURATION:-20s}"
    export PROTOCOL_MODE=http3
    "$K6H3" run "$H3SCPT" || warn "k6 HTTP/3 load exited non-zero (pcap may still be useful)"
  else
    warn "k6-http3 or script missing; QUIC capture may contain little traffic"
  fi

  if [[ -n "${pcap_pid:-}" ]]; then
    say "QUIC: stopping capture…"
    sudo kill "$pcap_pid" 2>/dev/null || kill "$pcap_pid" 2>/dev/null || true
    wait "$pcap_pid" 2>/dev/null || true
  fi

  say "QUIC: analyze metrics → $QUIC_OUT/analysis/quic-metrics.json"
  python3 "$LIB_DIR/analyze_quic_metrics.py" "$pcap" >"$QUIC_OUT/analysis/quic-metrics.json"

  say "QUIC: loss model → $QUIC_OUT/analysis/loss.json"
  python3 "$LIB_DIR/loss_model.py" "$QUIC_OUT/analysis/quic-metrics.json" >"$QUIC_OUT/analysis/loss.json"

  local knee_out="$QUIC_OUT/analysis/knee.json"
  if [[ -n "${KNEE_STEPS_JSON:-}" ]] && [[ -f "$KNEE_STEPS_JSON" ]]; then
    say "QUIC: knee detection (KNEE_STEPS_JSON)…"
    python3 "$LIB_DIR/knee_detection_v3.py" "$KNEE_STEPS_JSON" >"$knee_out"
  elif [[ -f "$QUIC_OUT/analysis/ramp_steps.json" ]]; then
    say "QUIC: knee detection (ramp_steps.json)…"
    python3 "$LIB_DIR/knee_detection_v3.py" "$QUIC_OUT/analysis/ramp_steps.json" >"$knee_out"
  else
    echo '{"knee":null,"note":"knee_detection_v3 expects ramp step series; set KNEE_STEPS_JSON or add quic/analysis/ramp_steps.json"}' >"$knee_out"
  fi

  say "QUIC: dominance map → $QUIC_OUT/analysis/dominance-map.json"
  python3 "$LIB_DIR/dominance_map.py" \
    --happiness-matrix "$ROOT/bench_logs/performance-lab/protocol-happiness-matrix.json" \
    --quic-metrics "$QUIC_OUT/analysis/quic-metrics.json" \
    --out "$QUIC_OUT/analysis/dominance-map.json"
}

say "Transport lab output: $OUT"

if [[ "${SKIP_FULL_EDGE:-0}" != "1" ]]; then
  say "1/4 full-edge transport validation (kubectl + curl + grpcurl)…"
  if bash "$ROOT/scripts/protocol/full-edge-transport-validation.sh" "$OUT"; then
    ok "full-edge validation OK"
  else
    echo "⚠️  full-edge validation failed (see $OUT/per-service/*.json) — continuing to compose + coverage"
  fi
else
  say "1/4 SKIP_FULL_EDGE=1 — reusing existing per-service JSON if present"
fi

say "2/4 endpoint coverage analyzer (heuristic)…"
node "$ROOT/scripts/protocol/endpoint-coverage-analyze.js" --repo-root "$ROOT" \
  --out "$ROOT/bench_logs/performance-lab/endpoint-coverage-report.json" || true

if [[ "${TRANSPORT_LAB_QUIC:-0}" == "1" ]]; then
  say "2b/4 QUIC capture + analysis (TRANSPORT_LAB_QUIC=1)…"
  _transport_quic_phase || warn "QUIC phase had issues — continuing"
else
  say "2b/4 QUIC pipeline skipped (set TRANSPORT_LAB_QUIC=1 for pcap + analyzers)"
fi

if [[ "${SKIP_COLLAPSE_SMOKE:-0}" != "1" ]] && command -v k6 >/dev/null 2>&1; then
  say "3/4 collapse smoke (k6 gateway health, H2, moderate VUs)…"
  bash "$ROOT/scripts/protocol/collapse-smoke-h2-h3.sh" "$OUT" || true
else
  say "3/4 collapse smoke skipped (k6 missing or SKIP_COLLAPSE_SMOKE=1)"
  echo '{"skipped":true,"reason":"k6 not installed or SKIP_COLLAPSE_SMOKE=1"}' >"$OUT/collapse-smoke-report.json"
fi

say "4/4 compose final-transport-artifact.json…"
node "$ROOT/scripts/transport/compose-final-artifact.js" --transport-dir "$OUT" \
  --perf-dir "$ROOT/bench_logs/performance-lab" \
  --out "$OUT/final-transport-artifact.json"

ok "Transport lab complete: $OUT/final-transport-artifact.json"
