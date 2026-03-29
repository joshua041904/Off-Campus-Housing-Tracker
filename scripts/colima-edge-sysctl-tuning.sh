#!/usr/bin/env bash
# Apply larger SYN / listen backlogs on the Colima Linux VM (or any node) to reduce dial timeout under k6 ramp.
# Run inside the VM:  colima ssh -- sudo bash -s < scripts/colima-edge-sysctl-tuning.sh
# Or from host:       colima ssh -- "sudo sysctl -w net.core.somaxconn=4096 ..."
#
# Persist: create /etc/sysctl.d/99-och-edge.conf with the same keys (distribution-specific).
set -euo pipefail

apply() {
  echo "Applying edge-oriented sysctls (ephemeral until reboot unless persisted)..."
  sysctl -w net.core.somaxconn=4096
  sysctl -w net.ipv4.tcp_max_syn_backlog=4096
  # Faster TIME_WAIT recycle pressure relief (verify for your kernel/workload).
  sysctl -w net.ipv4.tcp_fin_timeout=15 2>/dev/null || true
  echo "Done. Verify: sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog"
}

if [[ "$(id -u)" -eq 0 ]]; then
  apply
else
  echo "Re-exec with sudo..."
  exec sudo bash "$0" "$@"
fi
