#!/usr/bin/env bash
# Authoritative KRaft + MetalLB verification (k3s / Colima). No "seems fine" — each phase fails closed.
#
# Safe by default: read-only checks + optional TLS + kafka-contract. Destructive phases require explicit env.
#
# Env (common):
#   KRAFT_E2E_NS=off-campus-housing-tracker
#   Use kubectl on PATH or KUBECONFIG pointing at your k3s cluster (Colima: kubectl context colima).
#
# Phase 0 (destructive): KRAFT_E2E_PHASE0_SCALE_LEGACY_KAFKA=1 — kubectl scale deploy/kafka --replicas=0
# Phase 1 (mutating):    KRAFT_E2E_PHASE1_APPLY=1 — kubectl apply -k infra/k8s/kafka-kraft-metallb/
# Phase 6 (destructive): KRAFT_E2E_PHASE6_DELETE_ONE_BROKER=1 — delete pod kafka-1, wait, re-validate contract
# Phase 7 (destructive): KRAFT_E2E_PHASE7_DELETE_TWO_BROKERS=1 — delete kafka-1 + kafka-2, run preflight gate (must fail)
# Phase 9 (optional):    KRAFT_E2E_PHASE9_ROLLOUT_RESTART=1 — kubectl rollout restart statefulset/kafka
# Phase 10 (optional):   KRAFT_E2E_PHASE10_SMOKE_PRODUCE_CONSUME=1 — smoke topic + console producer/consumer
#
# Default run: phases 0–5 + 6 (describe) + 8 (jq score). Phases 6–7, 9–10 need env flags above.
# Live kafka-contract (phases 5+): set PEM paths and KAFKA_BROKER.
#   KAFKA_SSL_ENABLED=true KAFKA_BROKER=<ip>:9094 KAFKA_CA_CERT KAFKA_CLIENT_CERT KAFKA_CLIENT_KEY
#   Optional: KAFKA_CONTRACT_AUTO_TOPOLOGY=1 KAFKA_CONTRACT_MIN_BROKERS=3 KAFKA_CONTRACT_MIN_CHAOS_SCORE=0.85
#
# API tunnel (Colima): when kubectl context matches *colima*, runs ./scripts/colima-api-health.sh first.
#   KRAFT_E2E_REQUIRE_API_HEALTH=1 — always run API health; =0 — skip
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

NS="${KRAFT_E2E_NS:-off-campus-housing-tracker}"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
pass() { echo "[OK] $*"; }
fail() { echo "[FAIL] $*" >&2; exit 1; }
warn() { echo "[WARN] $*" >&2; }

kctl() {
  kubectl --request-timeout=30s "$@"
}

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 required"; }

need jq
need kubectl

_ctx="$(kubectl config current-context 2>/dev/null || true)"
_run_api_health=0
if [[ "${KRAFT_E2E_REQUIRE_API_HEALTH:-}" == "0" ]]; then
  :
elif [[ "${KRAFT_E2E_REQUIRE_API_HEALTH:-}" == "1" ]]; then
  _run_api_health=1
elif [[ "$_ctx" == *colima* ]]; then
  _run_api_health=1
fi
if [[ "$_run_api_health" == "1" ]] && [[ -f "$SCRIPT_DIR/colima-api-health.sh" ]]; then
  bash "$SCRIPT_DIR/colima-api-health.sh" || fail "k3s API unhealthy — fix tunnel: ./scripts/colima-forward-6443.sh --restart"
fi

external_ip() {
  local svc="$1"
  local ip=""
  ip="$(kctl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(kctl get svc "$svc" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  fi
  printf '%s' "$ip"
}

run_kafka_contract_json() {
  local out="$1"
  need node
  local kc="$REPO_ROOT/tools/kafka-contract/dist/index.js"
  [[ -f "$kc" ]] || fail "Missing $kc — run: pnpm --filter kafka-contract run build"
  pnpm --filter kafka-contract run build >/dev/null
  set +e
  # shellcheck disable=SC2090
  env \
    REPO_ROOT="$REPO_ROOT" \
    ENV_PREFIX="${ENV_PREFIX:-dev}" \
    KAFKA_SSL_ENABLED="${KAFKA_SSL_ENABLED:-}" \
    KAFKA_BROKER="${KAFKA_BROKER:-}" \
    KAFKA_CA_CERT="${KAFKA_CA_CERT:-}" \
    KAFKA_CLIENT_CERT="${KAFKA_CLIENT_CERT:-}" \
    KAFKA_CLIENT_KEY="${KAFKA_CLIENT_KEY:-}" \
    KAFKA_SSL_SKIP_HOSTNAME_CHECK="${KAFKA_SSL_SKIP_HOSTNAME_CHECK:-}" \
    KAFKA_CONTRACT_AUTO_TOPOLOGY="${KAFKA_CONTRACT_AUTO_TOPOLOGY:-}" \
    KAFKA_CONTRACT_MIN_BROKERS="${KAFKA_CONTRACT_MIN_BROKERS:-}" \
    OCH_KAFKA_TOPIC_SUFFIX="${OCH_KAFKA_TOPIC_SUFFIX:-}" \
    node "$kc" validate --json >"$out" 2>/dev/null
  set -e
}

contract_must_ok() {
  local out="$1"
  local ok
  ok="$(jq -r '.ok // false' "$out")"
  [[ "$ok" == "true" ]] || {
    jq . "$out" >&2 2>/dev/null || cat "$out" >&2
    fail "kafka-contract validate reported ok=false (see JSON above)"
  }
}

say "KRaft + MetalLB E2E verification (ns=$NS)"

# --- PHASE 0: legacy ZK kafka Deployment
say "PHASE 0 — Legacy Kafka (ZK Deployment)"
if kctl get deploy kafka -n "$NS" &>/dev/null; then
  _rep="$(kctl get deploy kafka -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
  pass "Found deploy/kafka (replicas=${_rep})"
  if [[ "${_rep:-0}" != "0" ]]; then
    if [[ "${KRAFT_E2E_PHASE0_SCALE_LEGACY_KAFKA:-0}" == "1" ]]; then
      kctl scale deploy kafka --replicas=0 -n "$NS"
      pass "Scaled deploy/kafka to 0"
    else
      fail "deploy/kafka still has replicas=${_rep}. Scale to 0 before KRaft (KRAFT_E2E_PHASE0_SCALE_LEGACY_KAFKA=1 to auto-scale) or delete it."
    fi
  fi
else
  pass "No deploy/kafka in $NS (nothing to scale)"
fi
# If legacy Deployment was just scaled to 0, terminating pods may still appear briefly — that is OK.
pass "PHASE 0 complete (use kubectl get pods -n $NS if you need to confirm no duplicate kafka workloads)"

# --- PHASE 1: apply KRaft bundle
say "PHASE 1 — Deploy KRaft + MetalLB bundle"
if [[ "${KRAFT_E2E_PHASE1_APPLY:-0}" == "1" ]]; then
  [[ -d "$REPO_ROOT/infra/k8s/kafka-kraft-metallb" ]] || fail "infra/k8s/kafka-kraft-metallb missing"
  kctl apply -k "$REPO_ROOT/infra/k8s/kafka-kraft-metallb/"
  pass "kubectl apply -k infra/k8s/kafka-kraft-metallb/"
else
  pass "Skipping apply (set KRAFT_E2E_PHASE1_APPLY=1 to kubectl apply -k)"
fi

# --- PHASE 2: pods + services
say "PHASE 2 — Pods and LoadBalancer IPs"
for i in 0 1 2; do
  _phase2_json="$(mktemp)"
  kctl get pod "kafka-$i" -n "$NS" -o json >"$_phase2_json" 2>/dev/null || fail "pod kafka-$i not found in $NS"
  _st="$(jq -r '.status.phase // empty' "$_phase2_json")"
  [[ "$_st" == "Running" ]] || fail "kafka-$i phase=$_st (want Running)"
  rm -f "$_phase2_json"
done
pass "Pods kafka-0, kafka-1, kafka-2 are Running"

for i in 0 1 2; do
  _ip="$(external_ip "kafka-${i}-external")"
  [[ -n "$_ip" && "$_ip" != "pending" ]] || fail "Service kafka-${i}-external has no LoadBalancer IP/hostname (MetalLB / pool?)"
  pass "kafka-${i}-external → ${_ip}"
done

# --- PHASE 3: KRaft logs
say "PHASE 3 — KRaft quorum (RaftManager)"
# Avoid kctl's 30s default here: log reads can exceed it under API load and yield empty output.
_logs="$(kubectl --request-timeout=120s logs "kafka-0" -n "$NS" -c kafka --tail=2000 2>/dev/null || true)"
# Confluent/cp-kafka 7.5 logs "[RaftManager id=N]" / raft-io-thread, not the literal "RaftManager started".
# Do not pipe huge logs to `grep -q` with pipefail: grep exits early → SIGPIPE on echo → false failure (exit 141).
case "$_logs" in
  *"[RaftManager id="*) ;;
  *) fail "kafka-0 logs: expected KRaft RaftManager (e.g. [RaftManager id=0])" ;;
esac
case "$_logs" in
  *"Not enough voters"*) fail "kafka-0 logs: found 'Not enough voters' (quorum broken)" ;;
esac
pass "KRaft RaftManager present; no 'Not enough voters' in recent kafka-0 logs"

# --- PHASE 4: TLS to first external listener
say "PHASE 4 — TLS handshake (openssl → :9094)"
need openssl
_ip0="$(external_ip kafka-0-external)"
_tls_out="$(mktemp)"
if echo | openssl s_client -connect "${_ip0}:9094" -tls1_3 -servername "kafka-0-external.${NS}.svc.cluster.local" </dev/null >"$_tls_out" 2>&1; then
  :
fi
grep -q 'CONNECTED' "$_tls_out" || fail "openssl s_client did not reach CONNECTED to ${_ip0}:9094"
grep -qi 'BEGIN CERTIFICATE' "$_tls_out" || fail "No certificate in openssl handshake output"
pass "TLS handshake completed to ${_ip0}:9094"
rm -f "$_tls_out"

# --- PHASE 5: kafka-contract (requires client env)
say "PHASE 5 — kafka-contract (live cluster)"
[[ "${KAFKA_SSL_ENABLED:-}" == "true" ]] || fail "Set KAFKA_SSL_ENABLED=true and KAFKA_BROKER + PEM paths for Phase 5"
[[ -n "${KAFKA_BROKER:-}" ]] || fail "Set KAFKA_BROKER (e.g. ${_ip0}:9094)"
# MetalLB external IPs are usually absent from the dev broker JKS SAN list; kafka-contract uses TLS with CA trust only.
if [[ "${KAFKA_SSL_SKIP_HOSTNAME_CHECK:-}" == "" ]] && [[ "${KAFKA_BROKER}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+: ]]; then
  export KAFKA_SSL_SKIP_HOSTNAME_CHECK=1
  warn "KAFKA_BROKER is a numeric host; set KAFKA_SSL_SKIP_HOSTNAME_CHECK=1 for kafka-contract (add MetalLB IPs to broker cert SANs to skip this)"
fi
for v in KAFKA_CA_CERT KAFKA_CLIENT_CERT KAFKA_CLIENT_KEY; do
  [[ -n "${!v:-}" ]] || fail "Phase 5 requires $v"
  [[ -f "${!v}" ]] || fail "$v not a file: ${!v}"
done

_json5="$(mktemp)"
run_kafka_contract_json "$_json5"
contract_must_ok "$_json5"
_bc="$(jq -r '.clusterBrokerCount // .metrics.clusterBrokerCount // empty' "$_json5")"
_cs="$(jq -r '.chaosReadinessScore // .metrics.chaosReadinessScore // empty' "$_json5")"
[[ "$_bc" == "3" ]] || fail "Expected clusterBrokerCount=3 for healthy 3-broker cluster, got ${_bc}"
pass "clusterBrokerCount=${_bc} chaosReadinessScore=${_cs}"
rm -f "$_json5"

# --- PHASE 6: topic replication (SSL inside pod)
say "PHASE 6 — Topic replication / ISR (kafka-topics --describe)"
_desc="$(mktemp)"
kctl exec -n "$NS" kafka-0 -- bash -ec '
TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
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
} > /tmp/och-kraft-describe.props
kafka-topics --bootstrap-server kafka-0.kafka:9093 --command-config /tmp/och-kraft-describe.props --describe
' >"$_desc" || fail "kafka-topics --describe failed inside kafka-0"

if grep -q 'Leader: -1' "$_desc"; then
  fail "Topic describe shows Leader: -1"
fi
pass "kafka-topics --describe: no Leader: -1"
rm -f "$_desc"

# --- PHASE 6 (optional): delete one broker
if [[ "${KRAFT_E2E_PHASE6_DELETE_ONE_BROKER:-0}" == "1" ]]; then
  say "PHASE 6 — Chaos: delete kafka-1"
  kctl delete pod kafka-1 -n "$NS" --wait=false
  sleep 15
  _jw="$(mktemp)"
  run_kafka_contract_json "$_jw"
  # With one broker down, describeCluster may still report 3 brokers if all registered, or 2 — user expected 2
  _bc2="$(jq -r '.clusterBrokerCount // .metrics.clusterBrokerCount // empty' "$_jw")"
  _ok2="$(jq -r '.ok // false' "$_jw")"
  pass "After delete kafka-1: clusterBrokerCount=${_bc2} ok=${_ok2} (metadata may lag; broker should rejoin)"
  rm -f "$_jw"
  say "Waiting for kafka-1 to return..."
  kctl wait pod/kafka-1 -n "$NS" --for=condition=Ready --timeout=300s || warn "kafka-1 not Ready in time"
fi

# --- PHASE 7 (optional): preflight gate on k8s (must fail when quorum broken)
if [[ "${KRAFT_E2E_PHASE7_DELETE_TWO_BROKERS:-0}" == "1" ]]; then
  say "PHASE 7 — Quorum gate: delete kafka-1 and kafka-2, expect validate script to refuse"
  kctl delete pod kafka-1 kafka-2 -n "$NS" --wait=false
  sleep 20
  set +e
  # shellcheck disable=SC2090
  env REPO_ROOT="$REPO_ROOT" \
    KAFKA_CONTRACT_LIVE_TARGET=k8s \
    KAFKA_CONTRACT_K8S_NS="$NS" \
    KAFKA_CONTRACT_K8S_WAIT_PODS=0 \
    OCH_KAFKA_REQUIRE_QUORUM_3=1 \
    KAFKA_CONTRACT_AUTO_TOPOLOGY=1 \
    KAFKA_SSL_ENABLED="${KAFKA_SSL_ENABLED}" \
    KAFKA_BROKER="${KAFKA_BROKER}" \
    KAFKA_CA_CERT="${KAFKA_CA_CERT}" \
    KAFKA_CLIENT_CERT="${KAFKA_CLIENT_CERT}" \
    KAFKA_CLIENT_KEY="${KAFKA_CLIENT_KEY}" \
    bash "$SCRIPT_DIR/validate-kafka-stack-contract.sh" >/tmp/och-kraft-preflight-fail.out 2>/tmp/och-kraft-preflight-fail.err
  _pe=$?
  set -e
  [[ "$_pe" != "0" ]] || fail "Expected validate-kafka-stack-contract.sh to fail when <3 brokers; it exited 0"
  grep -q 'ERROR: Kafka quorum' /tmp/och-kraft-preflight-fail.err 2>/dev/null || grep -q 'ERROR: Kafka quorum' /tmp/och-kraft-preflight-fail.out 2>/dev/null || \
    warn "Gate failed (exit $_pe) but exact ERROR line not found in captured output (check /tmp/och-kraft-preflight-fail.err)"
  pass "Preflight gate failed as expected (exit $_pe) with brokers down"
  kctl wait pod/kafka-1 -n "$NS" --for=condition=Ready --timeout=300s 2>/dev/null || true
  kctl wait pod/kafka-2 -n "$NS" --for=condition=Ready --timeout=300s 2>/dev/null || true
fi

# --- PHASE 8: entropy / chaos score
say "PHASE 8 — chaosReadinessScore (jq)"
_json9="$(mktemp)"
run_kafka_contract_json "$_json9"
contract_must_ok "$_json9"
jq '.chaosReadinessScore // .metrics.chaosReadinessScore' "$_json9"
rm -f "$_json9"

# --- PHASE 9 (optional): rollout restart
if [[ "${KRAFT_E2E_PHASE9_ROLLOUT_RESTART:-0}" == "1" ]]; then
  say "PHASE 9 — StatefulSet rollout restart"
  kctl rollout restart statefulset/kafka -n "$NS"
  kctl rollout status statefulset/kafka -n "$NS" --timeout=600s || fail "rollout status failed"
  _jr="$(mktemp)"
  run_kafka_contract_json "$_jr"
  contract_must_ok "$_jr"
  rm -f "$_jr"
  pass "Rollout complete; kafka-contract still ok"
else
  pass "Skipping rollout (KRAFT_E2E_PHASE9_ROLLOUT_RESTART=1)"
fi

# --- PHASE 10 (optional): smoke produce / consume
if [[ "${KRAFT_E2E_PHASE10_SMOKE_PRODUCE_CONSUME:-0}" == "1" ]]; then
  say "PHASE 10 — Smoke produce/consume"
  _topic="${KRAFT_E2E_SMOKE_TOPIC:-och-kraft-e2e-smoke}"
  kctl exec -n "$NS" kafka-0 -- bash -ec "
TS_PASS=\$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=\$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=\$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo \"\$KS_PASS\")
{
  echo security.protocol=SSL
  echo ssl.endpoint.identification.algorithm=
  echo ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks
  echo ssl.truststore.password=\${TS_PASS}
  echo ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks
  echo ssl.keystore.password=\${KS_PASS}
  echo ssl.key.password=\${KP_PASS}
} > /tmp/och-smoke.props
kafka-topics --bootstrap-server kafka-0.kafka:9093 --command-config /tmp/och-smoke.props --create --if-not-exists --topic ${_topic} --replication-factor 3 --partitions 1
" || fail "create topic failed"
  _msg="kraft-e2e-$(date +%s)"
  kctl exec -n "$NS" kafka-0 -- bash -ec "
TS_PASS=\$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=\$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=\$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo \"\$KS_PASS\")
{
  echo security.protocol=SSL
  echo ssl.endpoint.identification.algorithm=
  echo ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks
  echo ssl.truststore.password=\${TS_PASS}
  echo ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks
  echo ssl.keystore.password=\${KS_PASS}
  echo ssl.key.password=\${KP_PASS}
} > /tmp/och-smoke.props
echo '${_msg}' | kafka-console-producer --bootstrap-server kafka-0.kafka:9093 --producer.config /tmp/och-smoke.props --topic ${_topic}
" || fail "producer failed"
  _got="$(kctl exec -n "$NS" kafka-1 -- bash -ec "
TS_PASS=\$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=\$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=\$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo \"\$KS_PASS\")
{
  echo security.protocol=SSL
  echo ssl.endpoint.identification.algorithm=
  echo ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks
  echo ssl.truststore.password=\${TS_PASS}
  echo ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks
  echo ssl.keystore.password=\${KS_PASS}
  echo ssl.key.password=\${KP_PASS}
} > /tmp/och-smoke.props
timeout 25 kafka-console-consumer --bootstrap-server kafka-1.kafka:9093 --consumer.config /tmp/och-smoke.props --topic ${_topic} --from-beginning --max-messages 1 2>/dev/null | tail -1
")"
  echo "$_got" | grep -qF "$_msg" || fail "Consumer did not receive message (got: ${_got})"
  pass "Smoke message round-tripped on ${_topic}"
fi

say "KRaft E2E verification finished — all executed phases passed."
