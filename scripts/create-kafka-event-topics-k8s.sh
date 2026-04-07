#!/usr/bin/env bash
# Create the same proto-derived event topics as create-kafka-event-topics.sh, inside k3s KRaft Kafka.
# Uses kubectl exec on kafka-0 with SSL to kafka-0.kafka:9093 and replication factor 3 by default.
# Each create sets topic config min.insync.replicas=2 (aligns with broker KAFKA_MIN_INSYNC_REPLICAS).
# If a topic already exists with fewer partitions than PARTITIONS, runs --alter --partitions (Kafka cannot shrink).
#
# Prereqs: Stable API tunnel (./scripts/colima-api-health.sh), pods kafka-0..2 Ready.
#
# Env:
#   KAFKA_K8S_NS=off-campus-housing-tracker
#   KAFKA_K8S_POD=kafka-0
#   KAFKA_K8S_REPLICATION_FACTOR=3
#   ENV_PREFIX, PARTITIONS, OCH_KAFKA_TOPIC_SUFFIX — same as create-kafka-event-topics.sh
#   KAFKA_K8S_SKIP_API_HEALTH=1 — do not run colima-api-health.sh first
#   REPO_ROOT
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"
KPOD="${KAFKA_K8S_POD:-kafka-0}"
RF="${KAFKA_K8S_REPLICATION_FACTOR:-3}"
ENV_PREFIX="${ENV_PREFIX:-dev}"
PARTITIONS="${PARTITIONS:-6}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
die() { echo "❌ $*" >&2; exit 1; }

if [[ "${KAFKA_K8S_SKIP_API_HEALTH:-0}" != "1" ]] && [[ -f "$SCRIPT_DIR/colima-api-health.sh" ]]; then
  bash "$SCRIPT_DIR/colima-api-health.sh" || die "API unhealthy — stabilize tunnel before topic create"
fi

command -v kubectl >/dev/null 2>&1 || die "kubectl required"

kubectl get pod "$KPOD" -n "$NS" --request-timeout=30s >/dev/null 2>&1 || die "Pod $KPOD not found in $NS"

och_topic_suffix() {
  local raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  while [[ "$raw" == .* ]]; do raw="${raw#.}"; done
  if [[ -n "$raw" ]]; then printf '.%s' "$raw"; fi
}
SUF="$(och_topic_suffix)"

# shellcheck source=lib/och-kafka-event-topics-from-proto.sh
source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"
och_kafka_event_topics_fill || die "Could not build topic list from proto/events"
TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")

say "k8s Kafka topics (ns=$NS pod=$KPOD RF=$RF PARTITIONS=$PARTITIONS ENV_PREFIX=$ENV_PREFIX suffix='${SUF:-}')"

_inner_props='TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.endpoint.identification.algorithm="
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/och-k8s-topics.props'

kubectl exec -n "$NS" "$KPOD" -- bash -ec "$_inner_props" || die "Could not write TLS props in $KPOD"

BS="kafka-0.kafka:9093"

k8s_kafka_topics() {
  kubectl exec -n "$NS" "$KPOD" -- kafka-topics --bootstrap-server "$BS" --command-config /tmp/och-k8s-topics.props "$@"
}

# First summary line from --describe includes PartitionCount (per-partition rows use "Partition:" only).
partition_count_for_topic() {
  local t="$1"
  local out
  out="$(k8s_kafka_topics --describe --topic "$t" 2>/dev/null || true)"
  echo "$out" | sed -n 's/.*PartitionCount:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1
}

for t in "${TOPICS[@]}"; do
  k8s_kafka_topics \
    --create --if-not-exists --topic "$t" --partitions "$PARTITIONS" --replication-factor "$RF" \
    --config min.insync.replicas=2 \
    || die "Failed to create topic $t"
  ok "Ensured topic $t"
done

say "Aligning partition counts (--create --if-not-exists does not increase partitions on existing topics)..."
for t in "${TOPICS[@]}"; do
  pc="$(partition_count_for_topic "$t")"
  if [[ -n "${pc:-}" && "$pc" =~ ^[0-9]+$ && "$pc" -lt "$PARTITIONS" ]]; then
    k8s_kafka_topics --alter --topic "$t" --partitions "$PARTITIONS" \
      || die "Could not alter partitions for $t (have $pc, want $PARTITIONS)"
    ok "Altered partitions for $t ($pc → $PARTITIONS)"
  fi
done

say "Waiting for metadata (describe until PartitionCount matches)..."
for t in "${TOPICS[@]}"; do
  meta_ok=0
  for _i in $(seq 1 60); do
    out="$(k8s_kafka_topics --describe --topic "$t" 2>/dev/null || true)"
    if echo "$out" | grep -q "PartitionCount: $PARTITIONS"; then
      meta_ok=1
      ok "Topic metadata visible: $t"
      break
    fi
    sleep 1
  done
  if [[ "$meta_ok" != "1" ]]; then
    echo "❌ Timeout waiting for metadata on $t (expected PartitionCount: $PARTITIONS)." >&2
    echo "    kafka-topics --describe output:" >&2
    k8s_kafka_topics --describe --topic "$t" >&2 || true
    die "Fix: if PartitionCount differs, run alter (increase only) or delete and re-run this script. More partitions than $PARTITIONS require manual topic delete."
  fi
done

say "Done. k8s event topics aligned with proto/events (RF=$RF)."
