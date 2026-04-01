#!/usr/bin/env bash
# Simulate Colima VM stop/start (full node loss for single-node k3s).
# DESTRUCTIVE — requires explicit confirmation.
#
#   CHAOS_CONFIRM_COLIMA_REBOOT=1 ./scripts/chaos-node-reboot.sh
#
# After reboot (manual): make verify-kafka-cluster, verify edge/TLS scripts, preflight.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "${CHAOS_CONFIRM_COLIMA_REBOOT:-0}" != "1" ]]; then
  echo "Refusing: set CHAOS_CONFIRM_COLIMA_REBOOT=1 to stop/start Colima (disrupts all local k8s)."
  echo "After recovery, run: make verify-kafka-cluster (and your MetalLB/Caddy checks)."
  exit 0
fi

command -v colima >/dev/null 2>&1 || { echo "colima not found"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
ART="${CHAOS_ARTIFACT_DIR:-$REPO_ROOT/bench_logs/chaos-$STAMP}"
mkdir -p "$ART"
START=$(date +%s)
echo "chaos_node_reboot_start=$START" | tee "$ART/recovery-metrics.json"

echo "Stopping Colima…"
colima stop
sleep 10
echo "Starting Colima…"
colima start
sleep 20

END=$(date +%s)
echo "chaos_node_reboot_end=$END" >>"$ART/recovery-metrics.json"
echo "elapsed_sec=$((END - START))" >>"$ART/recovery-metrics.json"

kubectl get pods -A 2>&1 | tee "$ART/pods-after-reboot.txt" || true

python3 "$SCRIPT_DIR/generate-chaos-report.py" --dir "$ART" --scenario "colima node reboot" || true
echo "Artifacts: $ART"
