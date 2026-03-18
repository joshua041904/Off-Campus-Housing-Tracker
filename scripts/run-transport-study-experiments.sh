#!/usr/bin/env bash
# Transport-layer study experiments (docs/TRANSPORT_LAYER_STUDY_PLAN.md).
# Run after rotation suite; uses wire captures and optional cluster reconfig.
# TRANSPORT_STUDY_EXPERIMENTS=1,2,3,4,5,6 (comma-separated) or TRANSPORT_STUDY=1 for all.
# WIRE_CAPTURE_DIR: rotation wire capture dir (default: latest /tmp/rotation-wire-*).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

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
    _blatest=$(ls -td "$REPO_ROOT"/bench_logs/preflight-*/suite-logs 2>/dev/null | head -1)
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
      _code=$(curl -k -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 8 "https://${_node_ip}:${_np}/_caddy/healthz" -H "Host: off-campus-housing.local" 2>/dev/null || echo "000")
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
      info "  Point k6: BASE_URL=https://localhost:443 K6_RESOLVE=off-campus-housing.local:443:127.0.0.1"
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
  # In-cluster k6 runs by default (no env var needed)
  if [[ "${TRANSPORT_STUDY_RUN_EXP6:-1}" == "1" ]] && [[ -f "$SCRIPT_DIR/run-k6-chaos.sh" ]]; then
    info "  Running short in-cluster k6 (15s, low rate)..."
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
  info "  Deploy k6 as pod; target Caddy via ClusterIP (no MetalLB, no host NAT)."
  info "  If H3 scales to 200+ req/s → host virtualization is the limiter."
  info "  See docs/QUIC_HARDENING_CHECKLIST.md"
fi

say "=== Transport Study Complete ==="
info "Full plan: docs/TRANSPORT_LAYER_STUDY_PLAN.md"
info "Host HTTP/3: K6_HTTP3_NO_REUSE=1 is set by run-k6-phases.sh and run-k6-protocol-comparison.sh (avoids stale QUIC ~15s timeouts). For best isolation use Experiment 6 (k6 in-cluster)."
info "All 6 experiments run by default. Set TRANSPORT_STUDY_RUN_EXP4=0, TRANSPORT_STUDY_RUN_EXP5=0, or TRANSPORT_STUDY_RUN_EXP6=0 to skip NodePort check, Caddy setup check, or in-cluster k6."
