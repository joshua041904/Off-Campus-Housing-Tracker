#!/usr/bin/env bash
# Kafka stack contract: static repo checks + live compose broker (TLS API, topics, partitions).
# Exit 1 on any failure. Live checks target in-cluster KRaft Kafka (Compose broker removed).
#
# Env:
#   REPO_ROOT, ENV_PREFIX (default dev), OCH_KAFKA_TOPIC_SUFFIX (optional)
#   SKIP_KAFKA_CONTRACT=1 — exit 0 (e.g. SKIP_KAFKA bring-up)
#   KAFKA_CONTRACT_NO_LIVE=1 — only static + JKS checks (no docker kafka required)
#   KAFKA_CONTRACT_MIN_BROKERS=N — after live checks, fail if kafka-contract describeCluster count < N
#   OCH_KAFKA_REQUIRE_QUORUM_3=1 — same as KAFKA_CONTRACT_MIN_BROKERS=3 (k8s KRaft / production gate)
#   KAFKA_CONTRACT_MIN_CHAOS_SCORE=0.85 — fail if kafka-contract chaosReadinessScore is below threshold (needs jq)
#   KAFKA_CONTRACT_LIVE_TARGET=k8s — skip docker compose live path; validate via kubectl + kafka-contract (MetalLB / in-cluster)
#     Requires: kubectl, KAFKA_BROKER, KAFKA_SSL_ENABLED=true, KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY
#   KAFKA_CONTRACT_K8S_NS — default off-campus-housing-tracker
#   KAFKA_CONTRACT_K8S_WAIT_PODS=0 — skip kubectl wait for kafka-0..2 Ready (e.g. chaos drills)
#   PREFLIGHT_SKIP_* — passed through to verify-jks / wait script where applicable
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

ENV_PREFIX="${ENV_PREFIX:-dev}"

pass() { echo "[OK] $*"; }
fail() { echo "[FAIL] $*" >&2; exit 1; }

# Optional gates on kafka-contract JSON (quorum broker count, chaos score). Args: path to validate --json output.
kafka_contract_apply_quorum_chaos_gates() {
  local json_path="$1"
  [[ -n "$json_path" && -f "$json_path" ]] || fail "kafka_contract_apply_quorum_chaos_gates: missing JSON file"
  local _req_brokers="${KAFKA_CONTRACT_MIN_BROKERS:-0}"
  [[ "${OCH_KAFKA_REQUIRE_QUORUM_3:-0}" == "1" ]] && _req_brokers=3

  if [[ "$_req_brokers" -eq 0 ]] && [[ -z "${KAFKA_CONTRACT_MIN_CHAOS_SCORE:-}" ]]; then
    return 0
  fi

  if [[ "$_req_brokers" -gt 0 ]]; then
    [[ "$_req_brokers" =~ ^[0-9]+$ ]] || fail "Invalid KAFKA_CONTRACT_MIN_BROKERS / quorum gate value"
    local _bc
    _bc="$(jq -r '.clusterBrokerCount // .metrics.clusterBrokerCount // empty' "$json_path")"
    [[ "$_bc" =~ ^[0-9]+$ ]] || fail "Could not read clusterBrokerCount from kafka-contract JSON"
    if [[ "$_bc" -lt "$_req_brokers" ]]; then
      echo "ERROR: Kafka quorum — clusterBrokerCount=${_bc}; minimum ${_req_brokers} required" >&2
      fail "Kafka quorum gate: ${_bc} < ${_req_brokers} broker(s)"
    fi
    pass "kafka-contract quorum: clusterBrokerCount=${_bc} (min ${_req_brokers})"
  fi

  if [[ -n "${KAFKA_CONTRACT_MIN_CHAOS_SCORE:-}" ]]; then
    command -v awk >/dev/null 2>&1 || fail "awk required for KAFKA_CONTRACT_MIN_CHAOS_SCORE gate"
    local _cs
    _cs="$(jq -r '.chaosReadinessScore // .metrics.chaosReadinessScore // empty' "$json_path")"
    [[ -n "$_cs" && "$_cs" != "null" ]] || fail "Could not read chaosReadinessScore from kafka-contract JSON"
    awk -v s="$_cs" -v m="${KAFKA_CONTRACT_MIN_CHAOS_SCORE}" 'BEGIN { exit !(s + 0 >= m + 0) }' || \
      fail "chaosReadinessScore ${_cs} < ${KAFKA_CONTRACT_MIN_CHAOS_SCORE} (required minimum)"
    pass "kafka-contract chaosReadinessScore=${_cs} (min ${KAFKA_CONTRACT_MIN_CHAOS_SCORE})"
  fi
}

[[ "${SKIP_KAFKA_CONTRACT:-0}" == "1" ]] && exit 0

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "Kafka stack contract validation"

# --- Static: no OCH_KAFKA_DISABLED in TS sources
if grep -R --include='*.ts' -E '\bOCH_KAFKA_DISABLED\b' services scripts 2>/dev/null | grep -vE 'verify-housing-grpc-matrix|validate-kafka-stack-contract' | grep -q .; then
  fail "OCH_KAFKA_DISABLED must not appear in services/scripts TypeScript"
fi
pass "No OCH_KAFKA_DISABLED in TS sources"

# --- Static: broker signing scripts must include clientAuth alongside serverAuth for broker EKU
for _f in scripts/kafka-ssl-from-dev-root.sh scripts/dev-generate-certs.sh scripts/ci/generate-kafka-ci-tls.sh; do
  [[ -f "$_f" ]] || continue
  while IFS= read -r line; do
    case "$line" in
      *extendedKeyUsage*serverAuth*)
        if ! echo "$line" | grep -q clientAuth; then
          fail "Broker extendedKeyUsage must include clientAuth: $_f → $line"
        fi
        ;;
    esac
  done < <(grep -h 'extendedKeyUsage' "$_f" 2>/dev/null || true)
done
pass "Broker OpenSSL templates include clientAuth with serverAuth"

# --- Static: k8s Kafka manifests must not enable auto-create
for _och_kf in infra/k8s/base/kafka/deploy.yaml infra/k8s/kafka-kraft-metallb/statefulset.yaml; do
  [[ -f "$_och_kf" ]] || continue
  if grep 'KAFKA_AUTO_CREATE_TOPICS_ENABLE' "$_och_kf" | grep -qiE 'value:\s*"true"'; then
    fail "$_och_kf must not set KAFKA_AUTO_CREATE_TOPICS_ENABLE true"
  fi
done
pass "k8s Kafka manifests: auto-create not true (base + kraft-metallb)"

# --- Host: JKS (PrivateKeyEntry + serverAuth + clientAuth)
command -v keytool >/dev/null 2>&1 || fail "keytool required"
chmod +x "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" 2>/dev/null || true
REPO_ROOT="$REPO_ROOT" bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh"
pass "Broker keystore JKS (serverAuth + clientAuth + PrivateKeyEntry)"

# --- PEM SAN hint (optional file from dev-generate-certs; kafka-ssl-from-dev-root may not ship broker .crt)
_bpem="$REPO_ROOT/certs/kafka-ssl/kafka-broker.crt"
if [[ -f "$_bpem" ]] && command -v openssl >/dev/null 2>&1; then
  if ! openssl x509 -in "$_bpem" -text -noout | grep -q "Subject Alternative Name"; then
    fail "Broker PEM missing Subject Alternative Name extension: $_bpem"
  fi
  pass "Broker PEM has SAN (optional check)"
fi

[[ "${KAFKA_CONTRACT_NO_LIVE:-0}" == "1" ]] && {
  say "KAFKA_CONTRACT_NO_LIVE=1 — skipping live broker / topics"
  echo "Kafka stack contract: VALID (static + JKS only)"
  exit 0
}

if [[ "${KAFKA_CONTRACT_LIVE_TARGET:-k8s}" == "k8s" ]]; then
  say "Live target: k8s (skipping docker compose Kafka)"
  command -v kubectl >/dev/null 2>&1 || fail "kubectl required for KAFKA_CONTRACT_LIVE_TARGET=k8s"
  command -v jq >/dev/null 2>&1 || fail "jq required for KAFKA_CONTRACT_LIVE_TARGET=k8s"
  _kns="${KAFKA_CONTRACT_K8S_NS:-off-campus-housing-tracker}"
  [[ -n "${KAFKA_BROKER:-}" ]] || fail "KAFKA_CONTRACT_LIVE_TARGET=k8s requires KAFKA_BROKER (e.g. MetalLB-IP:9094)"
  [[ "${KAFKA_SSL_ENABLED:-}" == "true" ]] || fail "KAFKA_CONTRACT_LIVE_TARGET=k8s requires KAFKA_SSL_ENABLED=true"
  for _v in KAFKA_CA_CERT KAFKA_CLIENT_CERT KAFKA_CLIENT_KEY; do
    [[ -n "${!_v:-}" ]] || fail "KAFKA_CONTRACT_LIVE_TARGET=k8s requires ${_v}"
    [[ -f "${!_v}" ]] || fail "${_v} file missing: ${!_v}"
  done
  if [[ "${KAFKA_CONTRACT_K8S_WAIT_PODS:-1}" == "1" ]]; then
    for _i in 0 1 2; do
      kubectl wait pod "kafka-${_i}" -n "$_kns" --for=condition=Ready --timeout=300s || fail "kafka-${_i} not Ready in ${_kns}"
    done
    pass "k8s: kafka-0,1,2 Ready in ${_kns}"
  fi
  if kubectl get pod -n "$_kns" kafka-0 &>/dev/null; then
    _ac="$(kubectl exec -n "$_kns" kafka-0 -- printenv KAFKA_AUTO_CREATE_TOPICS_ENABLE 2>/dev/null || true)"
    echo "$_ac" | grep -qi false || fail "kafka-0 KAFKA_AUTO_CREATE_TOPICS_ENABLE must be false (got: ${_ac:-empty})"
    pass "k8s: KAFKA_AUTO_CREATE_TOPICS_ENABLE=false on kafka-0"
  else
    fail "k8s: pod kafka-0 not found in ${_kns}"
  fi

  command -v node >/dev/null 2>&1 || fail "node required for kafka-contract (k8s live)"
  _kc="$REPO_ROOT/tools/kafka-contract/dist/index.js"
  [[ -f "$_kc" ]] || fail "Missing $_kc — run: pnpm --filter kafka-contract run build"
  pnpm --filter kafka-contract run build >/dev/null 2>&1 || pnpm --filter kafka-contract run build

  _k8s_min_brokers="${KAFKA_CONTRACT_MIN_BROKERS:-0}"
  [[ "${OCH_KAFKA_REQUIRE_QUORUM_3:-0}" == "1" ]] && [[ "$_k8s_min_brokers" -eq 0 ]] && _k8s_min_brokers=3

  _kc_out="$(mktemp)"
  set +e
  # shellcheck disable=SC2090
  REPO_ROOT="$REPO_ROOT" ENV_PREFIX="$ENV_PREFIX" KAFKA_CONTRACT_MIN_BROKERS="$_k8s_min_brokers" \
    KAFKA_CONTRACT_AUTO_TOPOLOGY="${KAFKA_CONTRACT_AUTO_TOPOLOGY:-}" \
    node "$_kc" validate --json >"$_kc_out" 2>/dev/null
  set -e
  _kc_ok="$(jq -r '.ok // false' "$_kc_out")"
  if [[ "$_kc_ok" != "true" ]]; then
    jq . "$_kc_out" >&2 2>/dev/null || cat "$_kc_out" >&2
    rm -f "$_kc_out"
    fail "kafka-contract validate failed (KAFKA_CONTRACT_LIVE_TARGET=k8s)"
  fi
  pass "k8s: kafka-contract validate ok"
  kafka_contract_apply_quorum_chaos_gates "$_kc_out"
  rm -f "$_kc_out"

  say "Kafka stack contract: VALID (k8s live + policy)"
  exit 0
fi

fail "KAFKA_CONTRACT_LIVE_TARGET must be k8s (Docker Compose Kafka removed). Export KAFKA_BROKER + KAFKA_SSL_* client paths for kafka-contract."
