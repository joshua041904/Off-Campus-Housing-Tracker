#!/usr/bin/env bash
# Apply QUIC-friendly sysctls inside Colima VM (Step 8 engineering plan).
# Run before rotation/preflight to reduce UDP queue overflow and packet receive errors.
#
# Usage: ./scripts/colima-quic-sysctl.sh
#   COLIMA_QUIC_SKIP_BBR=1       — skip BBR (only apply UDP buffers + conntrack)
#   COLIMA_QUIC_SKIP_UDP=1       — skip UDP buffers (only apply BBR + conntrack)
#   COLIMA_QUIC_SKIP_CONNTRACK=1 — skip conntrack_max (e.g. if nf_conntrack unavailable)
#   COLIMA_QUIC_PERSIST=1        — append to /etc/sysctl.conf (survives VM restart)
#
# See: docs/TRANSPORT_LAYER_STUDY_PLAN.md, docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

if ! command -v colima >/dev/null 2>&1; then
  warn "colima not found; run on Linux host or install Colima"
  exit 0
fi

ctx=$(kubectl config current-context 2>/dev/null || true)
if [[ "$ctx" != *"colima"* ]]; then
  info "Context is not Colima ($ctx); skipping Colima sysctls"
  exit 0
fi

say "Applying QUIC/transport sysctls in Colima VM..."

SKIP_UDP="${COLIMA_QUIC_SKIP_UDP:-0}"
SKIP_BBR="${COLIMA_QUIC_SKIP_BBR:-0}"

# A. UDP buffers — reduce receive/send queue overflow (packet receive errors)
if [[ "$SKIP_UDP" != "1" ]]; then
  for key in net.core.rmem_max net.core.rmem_default net.core.wmem_max net.core.wmem_default; do
    if colima ssh -- sudo sysctl -w "${key}=2500000" 2>/dev/null; then
      ok "$key=2500000"
    else
      warn "Could not set $key"
    fi
  done
  # C. UDP receive queue — reduce drops under burst (netdev_max_backlog)
  if colima ssh -- sudo sysctl -w net.core.netdev_max_backlog=5000 2>/dev/null; then
    ok "net.core.netdev_max_backlog=5000"
  else
    warn "Could not set net.core.netdev_max_backlog"
  fi
fi

# D. Conntrack table — avoid drops when near max (UDP/QUIC sessions)
SKIP_CONNTRACK="${COLIMA_QUIC_SKIP_CONNTRACK:-0}"
if [[ "$SKIP_CONNTRACK" != "1" ]]; then
  if colima ssh -- sudo sysctl -w net.netfilter.nf_conntrack_max=262144 2>/dev/null; then
    ok "net.netfilter.nf_conntrack_max=262144"
  else
    warn "Could not set nf_conntrack_max (nf_conntrack module loaded? modprobe nf_conntrack)"
  fi
fi

# B. BBR congestion control (optional; preflight 7a also applies this)
if [[ "$SKIP_BBR" != "1" ]]; then
  _cc=$(colima ssh -- sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "")
  if [[ "$_cc" == "bbr" ]]; then
    ok "BBR already active"
  elif colima ssh -- sudo sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null; then
    ok "BBR enabled (was: ${_cc:-unknown})"
  else
    warn "Could not set BBR (available: $(colima ssh -- sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo '?')"
  fi
fi

# Optional: persist to survive VM restart
if [[ "${COLIMA_QUIC_PERSIST:-0}" == "1" ]]; then
  if {
    echo "# QUIC hardening (colima-quic-sysctl.sh)"
    echo "net.core.rmem_max=2500000"
    echo "net.core.rmem_default=2500000"
    echo "net.core.wmem_max=2500000"
    echo "net.core.wmem_default=2500000"
    echo "net.core.netdev_max_backlog=5000"
    echo "net.netfilter.nf_conntrack_max=262144"
    echo "net.ipv4.tcp_congestion_control=bbr"
  } | colima ssh -- sudo tee -a /etc/sysctl.conf >/dev/null 2>&1; then
    ok "Appended to /etc/sysctl.conf (COLIMA_QUIC_PERSIST=1)"
  else
    warn "Could not persist to /etc/sysctl.conf"
  fi
fi

ok "Colima QUIC sysctls applied. Re-run rotation to measure UDP drops (netstat -s before/after)."
