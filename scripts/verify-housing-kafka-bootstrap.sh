#!/usr/bin/env bash
# Report whether housing app-config exposes three Kafka bootstrap seeds (KRaft headless).
# Does not require a running cluster. With kubectl + live ConfigMap, also compares in-cluster value.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
CM="${APP_CONFIG_NAME:-app-config}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "Housing Kafka bootstrap (repo kustomize → infra/k8s/base/config)"
_kust="$(kubectl kustomize "$REPO_ROOT/infra/k8s/base/config" 2>/dev/null | grep -E '^\s+KAFKA_BROKER:' | head -1 || true)"
if [[ -z "$_kust" ]]; then
  warn "Could not kubectl kustomize base/config (kubectl missing?)"
else
  echo "  $_kust"
  _val="${_kust#*KAFKA_BROKER:}"
  _val="${_val//\"/}"
  _val="${_val// /}"
  IFS=',' read -r -a _seeds <<< "$_val"
  _n="${#_seeds[@]}"
  if [[ "$_n" -eq 3 ]]; then
    ok "KAFKA_BROKER lists 3 seeds (comma-separated)"
    for _s in "${_seeds[@]}"; do
      echo "    - $_s"
    done
  else
    echo "❌ Expected 3 comma-separated brokers, got count=$_n"
    exit 1
  fi
fi

if command -v kubectl >/dev/null 2>&1; then
  say "In-cluster ConfigMap (if present)"
  if kubectl get configmap "$CM" -n "$NS" --request-timeout=8s >/dev/null 2>&1; then
    _live="$(kubectl get configmap "$CM" -n "$NS" -o jsonpath='{.data.KAFKA_BROKER}' 2>/dev/null || true)"
    if [[ -n "$_live" ]]; then
      IFS=',' read -r -a _ls <<< "${_live// /}"
      _ln="${#_ls[@]}"
      echo "  KAFKA_BROKER: $_live"
      if [[ "$_ln" -eq 3 ]]; then
        ok "Live app-config has 3 seeds"
      else
        warn "Live app-config has $_ln seeds (expected 3) — re-apply base/config or kafka-host-compose overlay"
      fi
    else
      warn "ConfigMap $CM has no KAFKA_BROKER data key"
    fi
  else
    warn "No ConfigMap $CM in $NS (cluster not applied or different namespace)"
  fi
else
  warn "kubectl not on PATH — skipped live cluster check"
fi

say "Runtime wiring"
echo "  All services using @common/utils load brokers from process.env.KAFKA_BROKER"
echo "  (see services/common/src/kafka.ts — split on comma → kafkajs brokers[])."
echo "  KafkaJS uses the full list for metadata / partition-aware produce & consume."
ok "Done."
