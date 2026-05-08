#!/usr/bin/env bash
# Transport-layer study experiments (docs/TRANSPORT_LAYER_STUDY_PLAN.md).
# Run after rotation suite; uses wire captures and optional cluster reconfig.
# TRANSPORT_STUDY_EXPERIMENTS=1,2,3,4,5,6 (comma-separated) or TRANSPORT_STUDY=1 for all.
# TRANSPORT_STUDY_PCAP=1 — Experiment 8: scripts/capture-quic-pcap.sh → transport-forensics/ (PCAP + parse + invariants + .prom).
# WIRE_CAPTURE_DIR: rotation wire capture dir (default: latest /tmp/rotation-wire-*).
#
# PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 — Colima L1 capture for Experiment 6 only (in-cluster k6), then
#   transport-study-v7.json (v7b contract): scripts/transport-study-v7b.mjs assemble … --enforce-gates
#   (schemas/transport-study-v7b.schema.json). Hard gates: loss_estimate<=3, congestion>0, HTTP/2+3 in PCAP,
#   Jaeger overlap (>=3 trace ids, >=2 services, >=5 spans). Then verify-jaeger-trace-flows.mjs --strict-span-tree-contract
#   for booking-http, listings-http, auth-http, listings-analytics-async.
#   Needs: Colima context, TARGET_IP or MetalLB on ingress-nginx/caddy-h3, JAEGER_QUERY_BASE, node, tshark.
#   Skips Experiment 8 host curl PCAP when transport-study-v7.json exists (avoids duplicate / empty host capture).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export OCH_X_SUITE="${OCH_X_SUITE:-bash}"
# shellcheck source=scripts/lib/curl-with-suite.sh
source "$REPO_ROOT/scripts/lib/curl-with-suite.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "  ℹ️  $*"; }

# Resolve wire capture dir (latest rotation capture)
WIRE_DIR="${WIRE_CAPTURE_DIR:-}"
if [[ -z "$WIRE_DIR" ]]; then
  latest=$(ls -td /tmp/rotation-wire-* 2>/dev/null | head -1)
  [[ -n "$latest" ]] && [[ -d "$latest" ]] && WIRE_DIR="$latest"
fi

ENABLED="${TRANSPORT_STUDY_EXPERIMENTS:-}"
[[ "${TRANSPORT_STUDY:-1}" == "1" ]] && [[ -z "$ENABLED" ]] && ENABLED="1,2,3,4,5,6"

[[ -z "$ENABLED" ]] && { warn "Set TRANSPORT_STUDY=1 or TRANSPORT_STUDY_EXPERIMENTS=1,2,3,4,5,6"; exit 0; }

say "=== Transport-Layer Study Experiments ==="
info "Enabled: $ENABLED"
info "Wire capture dir: ${WIRE_DIR:-<none>}"

_has_exp() { echo "$ENABLED" | grep -qE "(^|,)${1}(,|$)"; }

# --- Experiment 1: UDP packet loss and receive errors (E. Measure UDP drops) ---
if _has_exp 1; then
  say "Experiment 1: UDP packet loss % and receive errors (pre vs post)"
  # 1a. UDP 443 packet count from wire capture (skip if no WIRE_DIR or tshark missing)
  if [[ -n "$WIRE_DIR" ]] && [[ -d "$WIRE_DIR" ]]; then
    if command -v tshark >/dev/null 2>&1; then
      total_udp=0
      for pcap in "$WIRE_DIR"/caddy-rotation-*.pcap; do
        [[ -f "$pcap" ]] || continue
        n=$(tshark -r "$pcap" -Y "udp.port == 443" 2>/dev/null | wc -l 2>/dev/null | tr -d '[:space:]')
        [[ "$n" =~ ^[0-9]+$ ]] && total_udp=$((total_udp + n))
      done
      ok "UDP 443 packets (QUIC): $total_udp"
    else
      info "  tshark not installed; UDP packet count skipped (install tshark for 1a)"
    fi
  fi
  # 1b. Compare packet receive errors (pre vs post) — automated when ROTATION_UDP_STATS=1
  _pre=""
  _post=""
  [[ -n "$WIRE_DIR" ]] && _pre="$WIRE_DIR/colima-vm-netstat-pre.txt" && _post="$WIRE_DIR/colima-vm-netstat-post.txt"
  if [[ -n "$_pre" ]] && [[ -f "$_pre" ]] && [[ -n "$_post" ]] && [[ -f "$_post" ]]; then
    pre_errors=$(grep -E 'packet receive errors' "$_pre" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")
    post_errors=$(grep -E 'packet receive errors' "$_post" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")
    pre_errors=${pre_errors:-0}
    post_errors=${post_errors:-0}
    delta=$((post_errors - pre_errors))
    if [[ "$delta" -gt 0 ]]; then
      warn "  UDP packet receive errors: pre=$pre_errors, post=$post_errors, delta=+$delta (queue overflow?)"
    else
      ok "  UDP packet receive errors: pre=$pre_errors, post=$post_errors, delta=$delta"
    fi
    info "  Full stats: $_pre, $_post"
  else
    info "  For UDP drops: run with ROTATION_UDP_STATS=1 (Colima default) to capture netstat pre/post"
    info "  Or manually: colima ssh → netstat -s before/after rotation; compare 'packet receive errors'"
  fi
fi

# --- Experiment 2: QUIC congestion window / latency from rotation ---
if _has_exp 2; then
  say "Experiment 2: QUIC congestion window growth"
  _summary=""
  _exp2_done=0
  [[ -n "$WIRE_DIR" ]] && [[ -d "$WIRE_DIR" ]] && _summary="$WIRE_DIR/rotation-summary.json"
  if [[ -z "$_summary" ]] || [[ ! -f "$_summary" ]]; then
    latest=$(ls -td /tmp/rotation-wire-* 2>/dev/null | head -1)
    [[ -n "$latest" ]] && [[ -d "$latest" ]] && _summary="$latest/rotation-summary.json"
  fi
  if [[ -z "$_summary" ]] || [[ ! -f "$_summary" ]]; then
    _blatest=$(ls -td "$REPO_ROOT"/bench_logs/run-*/suite-logs 2>/dev/null | head -1)
    [[ -z "$_blatest" ]] && _blatest=$(ls -td "$REPO_ROOT"/bench_logs/preflight-*/suite-logs 2>/dev/null | head -1)
    [[ -n "$_blatest" ]] && [[ -f "$_blatest/rotation-summary.json" ]] && _summary="$_blatest/rotation-summary.json"
  fi
  if [[ -z "$_summary" ]] || [[ ! -f "$_summary" ]]; then
    [[ -f "$REPO_ROOT/rotation-summary.json" ]] && _summary="$REPO_ROOT/rotation-summary.json"
  fi
  _exp2_done=0
  if [[ -n "$_summary" ]] && [[ -f "$_summary" ]] && command -v jq >/dev/null 2>&1; then
    _lim=$(jq -r '.limits | "max_no_error: H2=\(.max_no_error.h2_req_s // "?") H3=\(.max_no_error.h3_req_s // "?") req/s"' "$_summary" 2>/dev/null || true)
    _iter=$(jq -r '.limits.iter_at_first_h3_error // .limits.iter_at_first_drop // empty' "$_summary" 2>/dev/null || true)
    _h2_p99=$(jq -r '.h2.p99 // .phase3.latency.h2.p99 // .phase2.latency.h2.p99 // .phase1.latency.h2.p99 // .latency.h2.p99 // empty' "$_summary" 2>/dev/null || true)
    _h3_p99=$(jq -r '.h3.p99 // .phase3.latency.h3.p99 // .phase2.latency.h3.p99 // .phase1.latency.h3.p99 // .latency.h3.p99 // empty' "$_summary" 2>/dev/null || true)
    _h2_avg=$(jq -r '.h2.avg // .phase3.latency.h2.avg // .phase1.latency.h2.avg // .latency.h2.avg // empty' "$_summary" 2>/dev/null || true)
    _h3_avg=$(jq -r '.h3.avg // .phase3.latency.h3.avg // .phase1.latency.h3.avg // .latency.h3.avg // empty' "$_summary" 2>/dev/null || true)
    [[ -n "$_lim" ]] && ok "  Rotation limits (from rotation-summary.json): $_lim" && _exp2_done=1
    [[ -n "$_iter" ]] && info "  First H3 error / drop at iteration: $_iter"
    if [[ -n "$_h2_p99" ]] && [[ -n "$_h3_p99" ]]; then
      ok "  Latency: H2 p99=${_h2_p99}ms avg=${_h2_avg}ms, H3 p99=${_h3_p99}ms avg=${_h3_avg}ms"
      info "  QUIC congestion: if H3 p99 > 50ms and H2 p99 < 20ms → QUIC cwnd or CPU throttle (not packet loss)"
      _exp2_done=1
    elif [[ -z "$_exp2_done" ]]; then
      info "  No latency keys in rotation-summary.json (run full rotation for phase latencies); qlog requires Caddy custom build"
    fi
  else
    if [[ -z "$_summary" ]] || [[ ! -f "$_summary" ]]; then
      info "  No rotation-summary.json found (run rotation suite first for limits/latency)"
    else
      info "  jq not installed; install for automatic limits/latency extraction"
    fi
  fi
  [[ "${_exp2_done:-0}" -eq 1 ]] || ok "  Experiment 2: completed (run rotation suite for limits/latency in rotation-summary.json)"
  info "  See docs/TRANSPORT_LAYER_STUDY_PLAN.md for manual steps"
fi

# --- Experiment 3: BBR vs CUBIC for H2 ---
if _has_exp 3; then
  say "Experiment 3: BBR vs CUBIC for HTTP/2"
  if command -v colima >/dev/null 2>&1; then
    _cc=$(colima ssh -- sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "")
    avail=$(colima ssh -- sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo "")
    if echo "$avail" | grep -q bbr; then
      ok "  BBR applied in preflight 7a (current: $_cc)"
      info "  For CUBIC baseline: COLIMA_QUIC_SKIP_BBR=1 ./scripts/colima-quic-sysctl.sh (reverts to cubic)"
      info "  Then: H3_RATE=0 ./scripts/rotation-suite.sh (H2-only load). Compare throughput/p99 with BBR run."
      if [[ "${TRANSPORT_STUDY_RUN_H2_BBR:-0}" == "1" ]]; then
        info "  TRANSPORT_STUDY_RUN_H2_BBR=1: running H2-only rotation (BBR already active)..."
        H3_RATE=0 ROTATION_H2_KEYLOG=0 ROTATE_CA=0 "$SCRIPT_DIR/rotation-suite.sh" 2>&1 | tail -50 || warn "H2-only run had issues"
      fi
    else
      warn "  BBR not in Colima VM (available: $avail). Skip or run on Linux host."
    fi
  else
    warn "  Colima not found; run on Linux host for BBR"
  fi
fi

# --- Experiment 4: MetalLB off, NodePort direct ---
if _has_exp 4; then
  say "Experiment 4: Disable MetalLB, test NodePort directly"
  # NodePort check runs by default (no env var needed)
  if [[ "${TRANSPORT_STUDY_RUN_EXP4:-1}" == "1" ]] && command -v kubectl >/dev/null 2>&1; then
    # Prefer IPv4 InternalIP only (jsonpath can return multiple addresses; take first token so curl gets one host)
    _node_ip=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | head -1 | awk '{print $1}' || true)
    _np=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || echo "30443")
    if [[ -n "$_node_ip" ]] && [[ -n "$_np" ]] && [[ "$_node_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      _code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 8 --resolve "off-campus-housing.test:${_np}:${_node_ip}" "https://off-campus-housing.test:${_np}/_caddy/healthz" 2>/dev/null || echo "000")
      if [[ "$_code" == "200" ]]; then
        ok "  NodePort check: $_node_ip:$_np reachable (HTTP $_code)"
      else
        warn "  NodePort check: $_node_ip:$_np returned $_code (VM-only; from host use port-forward or LB IP)"
      fi
    elif [[ -z "$_node_ip" ]] || [[ ! "$_node_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      info "  Node has no IPv4 InternalIP or kubectl returned multiple addresses; skip NodePort check (use first word only for curl)"
    else
      info "  Could not get node IP or NodePort; skip NodePort check"
    fi
  fi
  info "  Manual: kubectl -n kube-system scale deploy -l app=metallb --replicas=0"
  info "  Point k6 at node IP:30443 (NodePort). Compare latency/drops with MetalLB."
  info "  See docs/TRANSPORT_LAYER_STUDY_PLAN.md"
fi

# --- Experiment 5: Caddy outside VM ---
if _has_exp 5; then
  say "Experiment 5: Run Caddy outside VM"
  # Setup check runs by default (no env var needed)
  if [[ "${TRANSPORT_STUDY_RUN_EXP5:-1}" == "1" ]]; then
    info "  Checking for native Caddy setup..."
    if command -v caddy >/dev/null 2>&1; then
      _caddy_ver=$(caddy version 2>/dev/null | head -1 || echo "unknown")
      ok "  Caddy installed on host: $_caddy_ver"
      info "  To run: copy Caddyfile + certs to host dir, then:"
      info "    cd /tmp/caddy-native && caddy run --config Caddyfile"
      info "  Point k6: BASE_URL=https://localhost:443 K6_RESOLVE=off-campus-housing.test:443:127.0.0.1"
      info "  Compare p99/throughput with Colima-in-VM run (rotation-summary.json)"
    else
      info "  Caddy not installed on host; install: brew install caddy (macOS) or apt install caddy"
    fi
    if [[ -f "$SCRIPT_DIR/../Caddyfile" ]]; then
      info "  Caddyfile: $SCRIPT_DIR/../Caddyfile (copy to /tmp/caddy-native with certs/)"
    fi
    ok "  Experiment 5: setup check completed (native Caddy optional for comparison)"
  fi
  info "  Run Caddy natively (or Docker host net) with same Caddyfile; k6 from host."
  info "  Compare req/s at 0% failure, p99, drops vs Colima-in-VM."
  info "  See docs/TRANSPORT_LAYER_STUDY_PLAN.md"
fi

# --- Experiment 6: k6 inside cluster (best transport isolation) ---
if _has_exp 6; then
  say "Experiment 6: Run k6 inside cluster"
  if [[ "${TRANSPORT_STUDY_RUN_EXP6:-1}" == "1" ]] && [[ -f "$SCRIPT_DIR/run-k6-chaos.sh" ]]; then
    info "  Running short in-cluster k6 (15s, low rate)..."
    if [[ "${PREFLIGHT_TRANSPORT_STUDY_REQUIRED:-0}" == "1" ]]; then
      ctx6="$(kubectl config current-context 2>/dev/null || echo "")"
      if [[ "$ctx6" != *"colima"* ]] || ! command -v colima >/dev/null 2>&1; then
        echo "❌ PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 needs Colima + colima on PATH (context=${ctx6:-empty})" >&2
        exit 1
      fi
      if [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
        echo "❌ PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 needs JAEGER_QUERY_BASE for trace overlap correlation" >&2
        exit 1
      fi
      if ! command -v node >/dev/null 2>&1; then
        echo "❌ PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 needs node (transport-study-v7b + Jaeger validators)" >&2
        exit 1
      fi
      if ! command -v tshark >/dev/null 2>&1; then
        echo "❌ PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 needs tshark (http_protocol_proof from PCAP)" >&2
        exit 1
      fi
      _lb6="${TARGET_IP:-}"
      [[ -z "$_lb6" ]] && _lb6="$(kubectl get svc -n ingress-nginx caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
      if [[ -z "$_lb6" ]]; then
        echo "❌ PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 needs TARGET_IP or MetalLB IP on ingress-nginx/caddy-h3" >&2
        exit 1
      fi
      info "  PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1: L1 Colima capture during in-cluster k6 (LB=$_lb6)…"
      _ts_v7_out="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs}/transport-forensics/transport-study-v7.json"
      set +e
      (
        set -euo pipefail
        cd "$REPO_ROOT"
        export HOST="${HOST:-off-campus-housing.test}"
        export CAPTURE_NODE_ONLY=1 STRICT_QUIC_VALIDATION=1 CAPTURE_V2_LB_IP="$_lb6"
        unset CAPTURE_V2_L1_UDP_HOST_MATCH 2>/dev/null || true
        _fr6="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs}/transport-forensics"
        mkdir -p "$_fr6"
        export CAPTURE_RUN_TYPE=transport-study-k6
        export SSLKEYLOGFILE="$_fr6/transport-study-k6.sslkeylog"
        export CAPTURE_V2_TLS_KEYLOG="$SSLKEYLOGFILE"
        : >"$SSLKEYLOGFILE"
        # shellcheck source=lib/packet-capture-v2.sh
        source "$SCRIPT_DIR/lib/packet-capture-v2.sh"
        init_capture_session_v2
        start_capture_v2
        export K6_DURATION="${TRANSPORT_STUDY_K6_DURATION:-15s}"
        export H2_RATE="${TRANSPORT_STUDY_H2_RATE:-20}"
        export H3_RATE="${TRANSPORT_STUDY_H3_RATE:-10}"
        _job=""
        _job=$(ROTATION_H2_KEYLOG=0 K6_DURATION="$K6_DURATION" H2_RATE="$H2_RATE" H3_RATE="$H3_RATE" "$SCRIPT_DIR/run-k6-chaos.sh" start 2>/dev/null | grep -oE 'k6-chaos-[0-9]+' | head -1) || true
        [[ -n "$_job" ]] || { echo "transport-study: k6 chaos start failed" >&2; exit 2; }
        "$SCRIPT_DIR/run-k6-chaos.sh" wait "$_job" 90s
        stop_and_analyze_captures_v2
        _capd="$(packet_capture_dir)"
        [[ -f "$_capd/transport-summary-v7.json" ]] || { echo "transport-study: missing transport-summary-v7.json" >&2; exit 3; }
        _v7in="$_fr6/transport-summary-v7-input.json"
        cp -f "$_capd/transport-summary-v7.json" "$_v7in"
        _pcap="$_fr6/transport-study-k6.pcap"
        cp -f "$_capd/caddy-capture.pcap" "$_pcap" 2>/dev/null || cp -f "$_capd/node-capture.pcap" "$_pcap" 2>/dev/null || true
        [[ -f "$_pcap" ]] || { echo "transport-study: missing PCAP for v7b http_protocol_proof" >&2; exit 3; }
        JAEGER_QUERY_BASE="${JAEGER_QUERY_BASE}" node "$SCRIPT_DIR/transport-study-v7b.mjs" assemble \
          --v7-input "$_v7in" \
          --pcap "$_pcap" \
          --out "$_ts_v7_out" \
          --enforce-gates
        _trace_rep="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs}/trace-validation-7b"
        mkdir -p "$_trace_rep"
        for _fl in booking-http listings-http auth-http listings-analytics-async; do
          echo "transport-study: strict-span-tree ${_fl}"
          JAEGER_QUERY_BASE="${JAEGER_QUERY_BASE}" node "$SCRIPT_DIR/verify-jaeger-trace-flows.mjs" \
            --flow "$_fl" \
            --strict-span-tree-contract \
            --lookback "${TRANSPORT_STUDY_JAEGER_LOOKBACK:-600}" \
            --retries "${TRANSPORT_STUDY_JAEGER_RETRIES:-8}" \
            --report-dir "$_trace_rep" || exit 5
        done
      )
      _ts_rc=$?
      set -e
      if [[ "$_ts_rc" -eq 0 ]]; then
        ok "  Load-phase transport study OK → $_ts_v7_out (v7b gates + Jaeger overlap + strict span-tree flows)"
      else
        echo "❌ PREFLIGHT_TRANSPORT_STUDY_REQUIRED load-phase capture / gates failed (exit ${_ts_rc})" >&2
        exit 1
      fi
    else
      export K6_DURATION="${TRANSPORT_STUDY_K6_DURATION:-15s}"
      export H2_RATE="${TRANSPORT_STUDY_H2_RATE:-20}"
      export H3_RATE="${TRANSPORT_STUDY_H3_RATE:-10}"
      _job=""
      _job=$(ROTATION_H2_KEYLOG=0 K6_DURATION="$K6_DURATION" H2_RATE="$H2_RATE" H3_RATE="$H3_RATE" "$SCRIPT_DIR/run-k6-chaos.sh" start 2>/dev/null | grep -oE 'k6-chaos-[0-9]+' | head -1) || true
      if [[ -n "$_job" ]]; then
        if "$SCRIPT_DIR/run-k6-chaos.sh" wait "$_job" 90s 2>/dev/null; then
          ok "  In-cluster k6 job $_job completed (Experiment 6)"
        else
          warn "  In-cluster k6 job $_job did not complete within 90s (check: kubectl -n k6-load logs job/$_job)"
        fi
      else
        warn "  Could not start in-cluster k6 job (ensure k6-ca-cert ConfigMap and k6-custom image exist)"
      fi
    fi
  fi
  info "  Deploy k6 as pod; target Caddy via ClusterIP (no MetalLB, no host NAT)."
  info "  If H3 scales to 200+ req/s → host virtualization is the limiter."
  info "  See docs/QUIC_HARDENING_CHECKLIST.md"
fi

# --- QUIC / HTTP3 edge sanity (curl; logs ALPN / HTTP version hints; optional merge into transport-validation-report.json) ---
if [[ "${TRANSPORT_STUDY_QUIC_SANITY:-1}" == "1" ]]; then
  say "Experiment 7: QUIC / HTTP3 edge sanity (curl probes)"
  _ca="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
  _base="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs}"
  mkdir -p "$_base"
  _json="${_base}/quic-protocol-sanity.json"
  _log="${_base}/quic-debug.log"
  _h2=""
  _h3=""
  _h2n=1
  _h3n=1
  if [[ -f "$_ca" ]] && command -v curl >/dev/null 2>&1; then
    _h2=$(och_curl_suite -sSI --http2 --max-time 15 --cacert "$_ca" "https://${HOST:-off-campus-housing.test}/api/healthz" 2>>"$_log" | head -n 12 || true)
    _h2n=$?
    _h3=$(och_curl_suite -sSI --http3 --max-time 15 --cacert "$_ca" "https://${HOST:-off-campus-housing.test}/api/healthz" 2>>"$_log" | head -n 12 || true)
    _h3n=$?
  else
    echo "quic sanity skipped: need curl + certs/dev-root.pem (SSL_CERT_FILE)" >>"$_log"
  fi
  _h2_line="$(printf '%s\n' "$_h2" | head -n1)"
  _h3_line="$(printf '%s\n' "$_h3" | head -n1)"
  node -e '
const fs = require("fs");
const out = process.argv[1];
const host = process.argv[2];
const h2rc = Number(process.argv[3]);
const h3rc = Number(process.argv[4]);
const h2First = process.argv[5] || "";
const h3First = process.argv[6] || "";
const doc = {
  generated_at: new Date().toISOString(),
  host,
  curl_http2_exit: h2rc,
  curl_http3_exit: h3rc,
  http2_status_line: h2First.trim() || null,
  http3_status_line: h3First.trim() || null,
  notes: "HTTP/3 probe uses curl --http3; check quic-debug.log for stderr. STRICT_HTTP3 transport tests live in webapp e2e + full-edge-transport-validation.",
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
' "$_json" "${HOST:-off-campus-housing.test}" "${_h2n:-1}" "${_h3n:-1}" "$_h2_line" "$_h3_line" || true
  ok "  Wrote $_json (curl h2 exit=${_h2n}, h3 exit=${_h3n}; stderr tail → $_log)"
  _tv="${_base}/transport-validation-report.json"
  if [[ -f "$_tv" ]] && command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs");
const tv = process.argv[1];
const quic = process.argv[2];
let doc = {};
try { doc = JSON.parse(fs.readFileSync(tv, "utf8")); } catch { doc = { generated_at: new Date().toISOString() }; }
let q = {};
try { q = JSON.parse(fs.readFileSync(quic, "utf8")); } catch { q = {}; }
doc.quic_edge_sanity = q;
fs.writeFileSync(tv, JSON.stringify(doc, null, 2) + "\n");
' "$_tv" "$_json" 2>/dev/null || true
    info "  Merged quic_edge_sanity into $_tv (if present)"
  fi
fi

# --- Experiment 8: QUIC PCAP + passive parse + invariant gate (transport forensics) ---
if [[ "${TRANSPORT_STUDY_PCAP:-0}" == "1" ]]; then
  _fr_base="${PREFLIGHT_RUN_DIR:-$REPO_ROOT/bench_logs}"
  _fr="$_fr_base/transport-forensics"
  if [[ "${PREFLIGHT_TRANSPORT_STUDY_REQUIRED:-0}" == "1" ]] && [[ -f "$_fr/transport-study-v7.json" ]]; then
    say "Experiment 8: skipped (transport-study-v7.json already produced by load-phase k6 capture; PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1)"
    ok "  Forensics artifact: $_fr/transport-study-v7.json"
  else
  say "Experiment 8: QUIC PCAP transport forensics (tcpdump + tshark|dpkt + invariants)"
  mkdir -p "$_fr_base"
  mkdir -p "$_fr"
  chmod +x "$SCRIPT_DIR/capture-quic-pcap.sh" 2>/dev/null || true
  if ! "$SCRIPT_DIR/capture-quic-pcap.sh" "$_fr"; then
    warn "Experiment 8: capture-quic-pcap.sh failed (tcpdump permission? missing certs? set QUIC_PCAP_USE_SUDO=1 on macOS)"
    if [[ "${PREFLIGHT_STRICT_EXIT:-${QUIC_FORENSICS_STRICT:-0}}" == "1" ]]; then
      exit 1
    fi
  else
    ok "  Forensics → $_fr (quic-capture.pcap, quic-parse-report.json, quic-invariants.json, quic-transport.prom)"
  fi
  fi
fi

say "=== Transport Study Complete ==="
info "Full plan: docs/TRANSPORT_LAYER_STUDY_PLAN.md"
info "Host HTTP/3: K6_HTTP3_NO_REUSE=1 is set by run-k6-phases.sh and run-k6-protocol-comparison.sh (avoids stale QUIC ~15s timeouts). For best isolation use Experiment 6 (k6 in-cluster)."
info "Experiments 1–6 run by default. Set TRANSPORT_STUDY_RUN_EXP4=0, TRANSPORT_STUDY_RUN_EXP5=0, or TRANSPORT_STUDY_RUN_EXP6=0 to skip NodePort check, Caddy setup check, or in-cluster k6."
info "Experiment 7 (QUIC curl sanity): TRANSPORT_STUDY_QUIC_SANITY=0 to skip; writes quic-protocol-sanity.json + quic-debug.log under PREFLIGHT_RUN_DIR or bench_logs/."
info "Experiment 8 (QUIC PCAP): TRANSPORT_STUDY_PCAP=1; strict preflight defaults TRANSPORT_STUDY_PCAP=1 when PREFLIGHT_STRICT_EXIT=1 (override with TRANSPORT_STUDY_PCAP=0). See scripts/capture-quic-pcap.sh."
info "Load-phase study: PREFLIGHT_TRANSPORT_STUDY_REQUIRED=1 wraps Experiment 6 with Colima L1 capture → transport-study-v7.json (v7b via transport-study-v7b.mjs; skips Experiment 8 host curl PCAP when present)."
