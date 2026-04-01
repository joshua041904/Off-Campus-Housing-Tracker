#!/usr/bin/env bash
# Kafka broker partition simulation (iptables inside broker pod) — OPTIONAL / fragile.
# Many Kafka images lack iptables NET_ADMIN; this script defaults to **dry-run**.
#
# Heal: CHAOS_KAFKA_HEAL=1 ./scripts/chaos-kafka-partition.sh
# Inject: CHAOS_KAFKA_PARTITION_EXEC=1 CHAOS_KAFKA_BROKER=kafka-1 ./scripts/chaos-kafka-partition.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CHAOS_KAFKA_NS:-off-campus-housing-tracker}"
BR="${CHAOS_KAFKA_BROKER:-kafka-1}"

STAMP="$(date +%Y%m%d-%H%M%S)"
ART="${CHAOS_ARTIFACT_DIR:-$REPO_ROOT/bench_logs/chaos-kafka-$STAMP}"
mkdir -p "$ART"

if [[ "${CHAOS_KAFKA_HEAL:-0}" == "1" ]]; then
  echo "Healing: flush iptables in $NS/$BR (if reachable)…"
  kubectl exec -n "$NS" "$BR" -c kafka -- sh -c "command -v iptables >/dev/null && iptables -F OUTPUT 2>/dev/null; true" 2>&1 | tee "$ART/heal.log" || true
  exit 0
fi

if [[ "${CHAOS_KAFKA_PARTITION_EXEC:-0}" != "1" ]]; then
  cat <<EOF | tee "$ART/README.txt"
Dry-run only. To attempt inject (may fail without iptables/capabilities):

  CHAOS_KAFKA_PARTITION_EXEC=1 CHAOS_KAFKA_BROKER=$BR ./scripts/chaos-kafka-partition.sh

Collect logs after:

  kubectl logs -n $NS kafka-0 -c kafka --since=10m > $ART/kafka-0.log

Heal:

  CHAOS_KAFKA_HEAL=1 CHAOS_KAFKA_BROKER=$BR ./scripts/chaos-kafka-partition.sh
EOF
  exit 0
fi

echo "Injecting partition on $NS/$BR (best-effort)…"
kubectl exec -n "$NS" "$BR" -c kafka -- sh -c "
  command -v iptables >/dev/null 2>&1 || { echo 'no iptables'; exit 1; }
  iptables -A OUTPUT -p tcp --dport 9093 -j DROP 2>/dev/null || true
  iptables -A OUTPUT -p tcp --dport 9095 -j DROP 2>/dev/null || true
  echo done
" 2>&1 | tee "$ART/inject.log" || true

kubectl logs -n "$NS" kafka-0 -c kafka --since=5m 2>&1 | tee "$ART/kafka-0-tail.log" || true
python3 "$SCRIPT_DIR/generate-chaos-report.py" --dir "$ART" --scenario "kafka partition (iptables)" || true
