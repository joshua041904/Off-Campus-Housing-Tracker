#!/usr/bin/env bash
# Terminal menu for forensics + chaos + observability targets (team DX).
# Usage: ./scripts/resilience-interactive-menu.sh
# Non-interactive: RESILIENCE_MENU_CHOICE=9 ./scripts/resilience-interactive-menu.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

pick="${RESILIENCE_MENU_CHOICE:-}"

menu_text() {
  cat <<'MENU'

╔══════════════════════════════════════════════════════════════╗
║  OCH — Resilience & forensics menu                           ║
╠══════════════════════════════════════════════════════════════╣
║  1) cluster-log-sweep (keywords + restarts)                  ║
║  2) forensic-log-sweep (raw pod log tails → forensic/)       ║
║  3) network-command-center (pcap + QUIC/TLS/transport)      ║
║  4) tls-k8s-secrets-expiry (Prometheus textfile lines)       ║
║  5) chaos-suite baseline (verify + report, safe)            ║
║  6) chaos-kafka-partition (dry-run plan)                      ║
║  7) chaos-latency (dry-run — needs CONFIRM)                   ║
║  8) governed-chaos (suite + budget stub + score stub)         ║
║  9) deploy-monitoring-help (paths only)                       ║
║  0) Exit                                                      ║
╚══════════════════════════════════════════════════════════════╝
MENU
}

if [[ -z "$pick" ]]; then
  menu_text
  read -r -p "Select [0-9]: " pick || pick=0
fi

case "$pick" in
  1) bash "$SCRIPT_DIR/cluster-log-sweep.sh" ;;
  2) bash "$SCRIPT_DIR/forensic-log-sweep.sh" ;;
  3) bash "$SCRIPT_DIR/network-command-center.sh" ;;
  4) bash "$SCRIPT_DIR/tls-k8s-secrets-expiry.sh" ;;
  5) CHAOS_SUITE=baseline bash "$SCRIPT_DIR/run-chaos-suite.sh" ;;
  6) bash "$SCRIPT_DIR/chaos-kafka-partition.sh" ;;
  7) bash "$SCRIPT_DIR/chaos-latency.sh" ;;
  8) bash "$SCRIPT_DIR/run-governed-chaos.sh" ;;
  9) make -C "$REPO_ROOT" deploy-monitoring-help ;;
  0|"") echo "Bye." ;;
  *) echo "Unknown choice: $pick" ;;
esac
