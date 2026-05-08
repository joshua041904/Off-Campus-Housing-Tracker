#!/usr/bin/env bash
# Compare per-broker MetalLB Service IP (kafka-N-external) to EXTERNAL:// in advertised.listeners.
# Use when host clients time out to a wrong IP (e.g. old LB / Caddy IP) while KAFKA_BROKER seeds look correct.
#
# Usage:
#   bash scripts/kafka-diagnose-external-advertisement.sh
# Env: HOUSING_NS / NAMESPACE (default off-campus-housing-tracker)
set -euo pipefail
NS="${HOUSING_NS:-${NAMESPACE:-off-campus-housing-tracker}}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not on PATH" >&2
  exit 2
fi

fail=0
echo "=== Kafka EXTERNAL advertisement vs LoadBalancer (ns=$NS) ==="
for i in 0 1 2; do
  lb_ip="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -z "$lb_ip" ]]; then
    lb_ip="$(kubectl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  fi
  adv=""
  if kubectl get pod "kafka-${i}" -n "$NS" &>/dev/null; then
    adv="$(kubectl exec -n "$NS" "kafka-${i}" -- grep -E '^advertised\.listeners=' /etc/kafka/kafka.properties 2>/dev/null | head -1 || true)"
  fi
  ext_ip=""
  if [[ "$adv" =~ EXTERNAL://([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+):9094 ]]; then
    ext_ip="${BASH_REMATCH[1]}"
  fi
  echo ""
  echo "--- kafka-${i} ---"
  echo "  kafka-${i}-external LB: ${lb_ip:-<pending>}"
  echo "  advertised.listeners:   ${adv:-<unreadable>}"
  echo "  EXTERNAL IPv4 parsed:   ${ext_ip:-<none>}"
  if [[ -n "$lb_ip" && -n "$ext_ip" && "$lb_ip" != "$ext_ip" ]]; then
    echo "  MISMATCH: broker advertises ${ext_ip} but Service has ${lb_ip} (stale init / MetalLB drift?)" >&2
    fail=1
  elif [[ -n "$lb_ip" && -n "$ext_ip" ]]; then
    echo "  OK"
  else
    echo "  SKIP compare (missing LB IP or could not parse EXTERNAL from properties)" >&2
  fi
done

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "Remediation (dev): recycle brokers so initContainer re-fetches LB IP, then re-run partition skew / clients." >&2
  echo "  kubectl rollout restart statefulset/kafka -n $NS" >&2
  echo "  kubectl rollout status statefulset/kafka -n $NS --timeout=600s" >&2
  echo "If still wrong and dev-only: scale to 0, delete PVCs data-kafka-*, scale back (wipes topics)." >&2
  exit 1
fi
echo "All compared brokers match (or skipped). Repo script: $REPO/scripts/kafka-diagnose-external-advertisement.sh"
exit 0
