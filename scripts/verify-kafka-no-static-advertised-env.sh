#!/usr/bin/env bash
# Fail if the Kafka workload declares KAFKA_ADVERTISED_LISTENERS in the pod template env.
#
# For KRaft + MetalLB (infra/k8s/kafka-kraft-metallb/statefulset.yaml), EXTERNAL advertised IP must
# come from the init-container–written file and the main container startup script (dynamic), not from
# a static env entry that goes stale when MetalLB reassigns IPs.
#
# Legacy single-broker ZooKeeper Deployment (infra/k8s/base/kafka/deploy.yaml) sets this env by design;
# set VERIFY_KAFKA_ALLOW_LEGACY_STATIC_ADVERTISED=1 to allow that topology.
#
# Usage: ./scripts/verify-kafka-no-static-advertised-env.sh [namespace]
set -euo pipefail

NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

say "Kafka advertised.listeners env guard (ns=$NS)"

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }

# Exit 0 if JSON contains env KAFKA_ADVERTISED_LISTENERS on container kafka (bad).
has_advertised_env_in_json_stdin() {
  python3 -c '
import json, sys
d = json.load(sys.stdin)
for c in d.get("spec", {}).get("template", {}).get("spec", {}).get("containers") or []:
    if c.get("name") != "kafka":
        continue
    for e in c.get("env") or []:
        if e.get("name") == "KAFKA_ADVERTISED_LISTENERS":
            sys.exit(0)
sys.exit(1)
'
}

check_workload() {
  local kind="$1" name="$2" json
  json="$(kubectl get "$kind" "$name" -n "$NS" -o json --request-timeout=25s 2>/dev/null || true)"
  if [[ -z "$json" ]] || [[ "$json" == "null" ]]; then
    return 1
  fi
  if echo "$json" | has_advertised_env_in_json_stdin; then
    bad "$kind/$name: pod template sets env KAFKA_ADVERTISED_LISTENERS (static). Use dynamic injection (KRaft init + startup script) or set VERIFY_KAFKA_ALLOW_LEGACY_STATIC_ADVERTISED=1 for legacy ZK broker."
    return 1
  fi
  ok "$kind/$name: no static KAFKA_ADVERTISED_LISTENERS in pod env"
  return 0
}

legacy_ok="${VERIFY_KAFKA_ALLOW_LEGACY_STATIC_ADVERTISED:-0}"

if kubectl get sts kafka -n "$NS" --request-timeout=20s &>/dev/null; then
  if ! check_workload statefulset kafka; then
    exit 1
  fi
  ok "StatefulSet kafka: advertised.listeners must be set at runtime (not from workload env)"
  exit 0
fi

if kubectl get deploy kafka -n "$NS" --request-timeout=20s &>/dev/null; then
  _dj="$(kubectl get deploy kafka -n "$NS" -o json --request-timeout=25s)"
  if echo "$_dj" | has_advertised_env_in_json_stdin; then
    if [[ "$legacy_ok" == "1" ]]; then
      say "Deployment kafka uses static KAFKA_ADVERTISED_LISTENERS (VERIFY_KAFKA_ALLOW_LEGACY_STATIC_ADVERTISED=1)"
      exit 0
    fi
    bad "Deployment kafka declares KAFKA_ADVERTISED_LISTENERS in env — legacy ZK topology. Migrate to KRaft or export VERIFY_KAFKA_ALLOW_LEGACY_STATIC_ADVERTISED=1."
    exit 1
  fi
  ok "Deployment kafka: no KAFKA_ADVERTISED_LISTENERS in pod env"
  exit 0
fi

say "ℹ️  No StatefulSet/Deployment named kafka in $NS — skipping static advertised env guard"
exit 0
