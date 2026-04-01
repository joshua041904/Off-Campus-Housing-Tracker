#!/usr/bin/env bash
# Kafka KRaft "final verification ritual" — mechanical cluster health (not Docker Compose).
# Run after: cert regen, MetalLB IP change, StatefulSet restart, or kafka-kraft-metallb infra edits.
#
# Phases (fail fast):
#   6a2c0a) Workload env must not set KAFKA_ADVERTISED_LISTENERS (KRaft dynamic EXTERNAL) — verify-kafka-no-static-advertised-env.sh
#   1) TLS SANs (INTERNAL FQDN + MetalLB IP SANs) — verify-kafka-tls-sans.sh
#   2) advertised.listeners per broker — verify-kafka-kraft-advertised-listeners.sh
#   3) KRaft quorum responds with a leader — kafka-metadata-quorum describe --status
#   4) No leadership renounce lines in kafka-0 logs in a recent window (default --since=10m; not full history — rollouts/TLS churn earlier is normal)
#   5) Broker API — kafka-broker-api-versions against headless kafka:9093 (SSL + mTLS via --command-config; INTERNAL is not PLAINTEXT)
#
# Optional: VERIFY_KAFKA_INCLUDE_GATEWAY_NC=1 — also nc -vz kafka 9093 from first api-gateway pod (stricter path check).
#
# Phase 6a2c6 — CA / broker trust (fail fast on secret drift):
#   Compares SHA-256 fingerprints of ca-cert.pem in kafka-ssl-secret vs och-kafka-ssl-secret.
#   Verifies kafka-broker.pem chains to that CA (openssl verify).
#   VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS=1 — require listed Deployments to reference och-kafka-ssl-secret (after deploy-dev).
#   VERIFY_KAFKA_CLIENT_MOUNTS_ONLY=1 — run only the deployment mount check and exit (dev-onboard Phase 6b).
#   VERIFY_KAFKA_MOUNT_REQUIRED_DEPLOYS — space-separated names (default: Kafka consumer services in base/).
#
# Skips (for preflight when 6a2c/6a2c2 already ran):
#   VERIFY_KAFKA_HEALTH_ONLY=1 — skip phases 1–2; run 3–5 only
#   Or per-phase: VERIFY_KAFKA_SKIP_TLS_SANS=1, VERIFY_KAFKA_SKIP_ADVERTISED=1, VERIFY_KAFKA_SKIP_META_IDENTITY=1,
#   VERIFY_KAFKA_SKIP_STATIC_ADVERTISED_ENV=1 — skip guard: workload env must not set KAFKA_ADVERTISED_LISTENERS (KRaft)
#   VERIFY_KAFKA_SKIP_QUORUM_GATE=1, VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=1, VERIFY_KAFKA_SKIP_BROKER_API_GATE=1,
#   VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=1
#   VERIFY_KAFKA_REQUIRE_SECRET_CA_ANNOTATION=1 — fail if kafka-ssl-secret lacks och.dev/ca-fingerprint-sha256
#
# What would break this cluster (operational checklist):
#   - MetalLB IP changes without cert regen → external TLS fails (mitigation: KAFKA_SSL_AUTO_METALLB_IPS=1).
#   - advertised.listeners drift (wrong INTERNAL/EXTERNAL) → metadata / peer confusion (6a2c2 + phase 2).
#   - Missing INTERNAL FQDN in broker SAN → inter-broker TLS fails (phase 1).
#   - Deleting StatefulSet PVCs → metadata log loss; full re-bootstrap required.
#   - Wrong KAFKA_CONTROLLER_QUORUM_VOTERS → no controller election.
#   - EndpointSlice / headless DNS corruption → transient resolution failures.
#
# Usage:
#   ./scripts/verify-kafka-cluster.sh [namespace] [replicas]
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, KAFKA_CHURN_LOG_SINCE (default 10m for renounce scan)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${1:-${HOUSING_NS:-off-campus-housing-tracker}}"
REPLICAS="${2:-${KAFKA_BROKER_REPLICAS:-3}}"
CHURN_SINCE="${KAFKA_CHURN_LOG_SINCE:-10m}"
EXEC_TO="${KAFKA_CLUSTER_EXEC_TIMEOUT:-45}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

if [[ "${VERIFY_KAFKA_HEALTH_ONLY:-0}" == "1" ]]; then
  VERIFY_KAFKA_SKIP_TLS_SANS="${VERIFY_KAFKA_SKIP_TLS_SANS:-1}"
  VERIFY_KAFKA_SKIP_ADVERTISED="${VERIFY_KAFKA_SKIP_ADVERTISED:-1}"
  VERIFY_KAFKA_SKIP_META_IDENTITY="${VERIFY_KAFKA_SKIP_META_IDENTITY:-1}"
  VERIFY_KAFKA_SKIP_STATIC_ADVERTISED_ENV="${VERIFY_KAFKA_SKIP_STATIC_ADVERTISED_ENV:-1}"
fi

command -v kubectl >/dev/null 2>&1 || { bad "kubectl required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { bad "openssl required"; exit 1; }

_mount_required_deploys() {
  echo "${VERIFY_KAFKA_MOUNT_REQUIRED_DEPLOYS:-auth-service booking-service listings-service media-service notification-service analytics-service trust-service}"
}

if [[ "${VERIFY_KAFKA_CLIENT_MOUNTS_ONLY:-0}" == "1" ]]; then
  say "Kafka client secret mounts only (VERIFY_KAFKA_CLIENT_MOUNTS_ONLY=1)"
  _missing=0
  while read -r _d; do
    [[ -z "$_d" ]] && continue
    if ! kubectl get deploy "$_d" -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
      bad "Deployment $_d not found in $NS"
      _missing=1
      continue
    fi
    if ! kubectl get deploy "$_d" -n "$NS" -o yaml --request-timeout=25s | grep -q "secretName: och-kafka-ssl-secret"; then
      bad "Deployment $_d does not mount secret och-kafka-ssl-secret"
      _missing=1
    else
      ok "Deployment $_d references och-kafka-ssl-secret"
    fi
  done < <(tr ' ' '\n' <<<"$(_mount_required_deploys)" | grep -v '^$')
  [[ "$_missing" -eq 0 ]] || exit 1
  say "Kafka client mount verification PASSED"
  exit 0
fi

say "Kafka cluster verification (ns=$NS replicas=$REPLICAS)"

if [[ "${VERIFY_KAFKA_SKIP_META_IDENTITY:-0}" != "1" ]]; then
  say "Phase 6a2c0 — KRaft broker identity (meta.properties cluster.id + node.id)"
  EXPECTED_CID="${KAFKA_EXPECTED_CLUSTER_ID:-KfF3uZ3kQsyKJvYU8vHvBA}"
  declare -a _cids=()
  for ((i = 0; i < REPLICAS; i++)); do
    if ! kubectl get pod "kafka-$i" -n "$NS" --request-timeout=25s >/dev/null 2>&1; then
      bad "Pod kafka-$i not found in $NS (cannot read meta.properties)"
      exit 1
    fi
    _meta="$(kubectl exec -n "$NS" -i "kafka-$i" -c kafka --request-timeout="${EXEC_TO}s" -- \
      cat /var/lib/kafka/data/meta.properties 2>/dev/null || true)"
    if [[ -z "$_meta" ]]; then
      bad "meta.properties missing or unreadable on kafka-$i (storage not formatted yet?)"
      exit 1
    fi
    _nid="$(echo "$_meta" | grep -E '^node\.id=' | head -1 | cut -d= -f2- | tr -d '\r' || true)"
    _cid="$(echo "$_meta" | grep -E '^cluster\.id=' | head -1 | cut -d= -f2- | tr -d '\r' || true)"
    if [[ "$_nid" != "$i" ]]; then
      bad "kafka-$i meta.properties node.id=${_nid:-?} expected $i"
      exit 1
    fi
    if [[ -z "$_cid" ]]; then
      bad "kafka-$i meta.properties missing cluster.id"
      exit 1
    fi
    _cids+=("$_cid")
  done
  _ref="${_cids[0]}"
  for _c in "${_cids[@]}"; do
    if [[ "$_c" != "$_ref" ]]; then
      bad "cluster.id mismatch across brokers (ref=$_ref vs $_c). Data corruption or split brain — see make kafka-clean-slate (DESTROYS DATA)."
      exit 1
    fi
  done
  if [[ -n "$EXPECTED_CID" && "$_ref" != "$EXPECTED_CID" ]]; then
    bad "cluster.id=$_ref but expected KAFKA_EXPECTED_CLUSTER_ID=$EXPECTED_CID (PVCs from another cluster?)"
    exit 1
  fi
  ok "meta.properties: node.id 0..$((REPLICAS - 1)), single cluster.id ($_ref)"
else
  say "Phase 6a2c0 — skipped (VERIFY_KAFKA_SKIP_META_IDENTITY=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_STATIC_ADVERTISED_ENV:-0}" != "1" ]]; then
  say "Phase 6a2c0a — workload env must not pin KAFKA_ADVERTISED_LISTENERS (KRaft uses init + startup dynamic EXTERNAL IP)"
  chmod +x "$SCRIPT_DIR/verify-kafka-no-static-advertised-env.sh" 2>/dev/null || true
  bash "$SCRIPT_DIR/verify-kafka-no-static-advertised-env.sh" "$NS"
  ok "Static advertised env guard passed"
else
  say "Phase 6a2c0a — skipped (VERIFY_KAFKA_SKIP_STATIC_ADVERTISED_ENV=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_TLS_SANS:-0}" != "1" ]]; then
  say "Phase 6a2c — TLS SAN verification"
  chmod +x "$SCRIPT_DIR/verify-kafka-tls-sans.sh" 2>/dev/null || true
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$NS" "$REPLICAS"
  ok "TLS SAN verification passed"
else
  say "Phase 6a2c — skipped (VERIFY_KAFKA_SKIP_TLS_SANS=1 or VERIFY_KAFKA_HEALTH_ONLY=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_ADVERTISED:-0}" != "1" ]]; then
  say "Phase 6a2c2 — advertised.listeners verification"
  chmod +x "$SCRIPT_DIR/verify-kafka-kraft-advertised-listeners.sh" 2>/dev/null || true
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REPLICAS" bash "$SCRIPT_DIR/verify-kafka-kraft-advertised-listeners.sh" "$NS" "$REPLICAS"
  ok "advertised.listeners verification passed"
else
  say "Phase 6a2c2 — skipped (VERIFY_KAFKA_SKIP_ADVERTISED=1 or VERIFY_KAFKA_HEALTH_ONLY=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_TLS_CONSISTENCY:-0}" != "1" ]]; then
  say "Phase 6a2c6 — CA fingerprint consistency (kafka-ssl-secret vs och-kafka-ssl-secret) + broker chain"
  _tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap 'rm -rf "$_tmp"' EXIT
  kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$_tmp/broker-ca.pem"
  kubectl get secret och-kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$_tmp/service-ca.pem"
  kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.kafka-broker\.pem}' --request-timeout=25s | base64 -d >"$_tmp/kafka-broker.pem"
  if [[ ! -s "$_tmp/broker-ca.pem" || ! -s "$_tmp/service-ca.pem" || ! -s "$_tmp/kafka-broker.pem" ]]; then
    bad "Missing ca-cert.pem or kafka-broker.pem in secrets (kafka-ssl-secret / och-kafka-ssl-secret)"
    exit 1
  fi
  _bfp="$(openssl x509 -in "$_tmp/broker-ca.pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)"
  _sfp="$(openssl x509 -in "$_tmp/service-ca.pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)"
  if [[ -z "$_bfp" || -z "$_sfp" || "$_bfp" != "$_sfp" ]]; then
    bad "CA fingerprint mismatch — broker secret vs och-kafka-ssl-secret (Node clients will reject broker TLS)"
    echo "   kafka-ssl-secret ca:     ${_bfp:-?}" >&2
    echo "   och-kafka-ssl-secret ca: ${_sfp:-?}" >&2
    exit 1
  fi
  ok "CA fingerprints match ($_bfp)"
  _ann="$(kubectl get secret kafka-ssl-secret -n "$NS" -o go-template='{{index .metadata.annotations "och.dev/ca-fingerprint-sha256"}}' 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$_ann" && "$_ann" != "$_bfp" ]]; then
    bad "kafka-ssl-secret annotation och.dev/ca-fingerprint-sha256 does not match live ca-cert.pem (partial edit? annotation=$_ann computed=$_bfp)"
    exit 1
  fi
  if [[ -z "$_ann" && "${VERIFY_KAFKA_REQUIRE_SECRET_CA_ANNOTATION:-0}" == "1" ]]; then
    bad "kafka-ssl-secret missing annotation och.dev/ca-fingerprint-sha256 (re-run: make kafka-refresh-tls-from-lb or pnpm kafka-ssl)"
    exit 1
  fi
  [[ -n "$_ann" ]] && ok "Secret CA annotation matches computed fingerprint" || say "ℹ️  No och.dev/ca-fingerprint-sha256 annotation yet (non-fatal unless VERIFY_KAFKA_REQUIRE_SECRET_CA_ANNOTATION=1)"
  awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/{print; if (/END CERTIFICATE/) exit}' "$_tmp/kafka-broker.pem" >"$_tmp/broker-leaf.pem"
  if ! openssl verify -CAfile "$_tmp/broker-ca.pem" "$_tmp/broker-leaf.pem" >/dev/null 2>&1; then
    bad "Broker leaf in kafka-broker.pem does not verify against ca-cert.pem from kafka-ssl-secret"
    openssl verify -CAfile "$_tmp/broker-ca.pem" "$_tmp/broker-leaf.pem" >&2 || true
    exit 1
  fi
  _iss="$(openssl x509 -in "$_tmp/broker-leaf.pem" -noout -issuer -nameopt RFC2253 2>/dev/null | sed 's/^issuer=//')"
  _sub="$(openssl x509 -in "$_tmp/broker-ca.pem" -noout -subject -nameopt RFC2253 2>/dev/null | sed 's/^subject=//')"
  if [[ "$_iss" != "$_sub" ]]; then
    bad "Broker cert issuer does not match CA subject (issuer=$_iss subject=$_sub)"
    exit 1
  fi
  ok "Broker leaf verifies; issuer matches CA subject"
  trap - EXIT
  rm -rf "$_tmp"
else
  say "Phase 6a2c6 — skipped (VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=1)"
fi

if [[ "${VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS:-0}" == "1" ]]; then
  say "Phase 6a2c6b — Deployments must reference och-kafka-ssl-secret"
  _missing=0
  while read -r _d; do
    [[ -z "$_d" ]] && continue
    if ! kubectl get deploy "$_d" -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
      bad "Deployment $_d not found in $NS"
      _missing=1
      continue
    fi
    if ! kubectl get deploy "$_d" -n "$NS" -o yaml --request-timeout=25s | grep -q "secretName: och-kafka-ssl-secret"; then
      bad "Deployment $_d does not mount secret och-kafka-ssl-secret"
      _missing=1
    else
      ok "Deployment $_d references och-kafka-ssl-secret"
    fi
  done < <(tr ' ' '\n' <<<"$(_mount_required_deploys)" | grep -v '^$')
  [[ "$_missing" -eq 0 ]] || exit 1
fi

if [[ "${VERIFY_KAFKA_SKIP_QUORUM_GATE:-0}" == "1" ]] && [[ "${VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE:-0}" == "1" ]] && [[ "${VERIFY_KAFKA_SKIP_BROKER_API_GATE:-0}" == "1" ]]; then
  ok "Kafka cluster verification PASSED (TLS/advert gates only; kubectl health gates skipped)"
  exit 0
fi

if ! kubectl get pod kafka-0 -n "$NS" --request-timeout=25s >/dev/null 2>&1; then
  bad "Pod kafka-0 not found in $NS (cannot run quorum / API checks)"
  exit 1
fi

if [[ "${VERIFY_KAFKA_SKIP_QUORUM_GATE:-0}" != "1" ]]; then
  say "Phase 6a2c3 — KRaft quorum stability (metadata quorum describe --status, SSL INTERNAL)"
  _qout="$(
    kubectl exec -n "$NS" -i kafka-0 -c kafka --request-timeout="${EXEC_TO}s" -- bash -s 2>&1 <<'EOSCRIPT'
set -euo pipefail
TS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS")
PROP=/tmp/och-kafka-ritual-quorum.props
{
  echo "security.protocol=SSL"
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=$TS"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=$KS"
  echo "ssl.key.password=$KP"
  echo "ssl.endpoint.identification.algorithm="
} > "$PROP"
kafka-metadata-quorum --bootstrap-server kafka:9093 --command-config "$PROP" describe --status
rm -f "$PROP"
EOSCRIPT
  )" || {
    bad "kafka-metadata-quorum describe --status failed (broker not ready, quorum broken, or SSL client config?)"
    echo "$_qout" >&2
    exit 1
  }
  if ! echo "$_qout" | grep -qi "leaderid"; then
    bad "Quorum output missing LeaderId — unexpected describe --status format"
    echo "$_qout" >&2
    exit 1
  fi
  ok "Quorum reports LeaderId (metadata quorum reachable)"
else
  say "Phase 6a2c3 — skipped (VERIFY_KAFKA_SKIP_QUORUM_GATE=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE:-0}" != "1" ]]; then
  say "Phase 6a2c4 — leadership churn (kafka-0 logs since=$CHURN_SINCE: renounce / renouncing)"
  # Historical renounces during rolling restart, TLS, or advertised.listener changes are normal; only flag active churn.
  # Single "Renouncing ... due to a metadata log event" (epoch handoff) is expected KRaft behavior, not flapping.
  _churn="$(kubectl logs kafka-0 -n "$NS" -c kafka --request-timeout=60s --since="$CHURN_SINCE" 2>/dev/null | grep -i renoun | grep -viF 'due to a metadata log event' || true)"
  if echo "$_churn" | grep -q .; then
    bad "Leadership churn indicators in kafka-0 logs since $CHURN_SINCE (grep -i renoun matched):"
    echo "$_churn" | tail -n 40 >&2
    exit 1
  fi
  ok "No renounce/renouncing matches in kafka-0 logs since $CHURN_SINCE"
else
  say "Phase 6a2c4 — skipped (VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=1)"
fi

if [[ "${VERIFY_KAFKA_SKIP_BROKER_API_GATE:-0}" != "1" ]]; then
  say "Phase 6a2c5 — broker API responsiveness (kafka-broker-api-versions @ kafka:9093, SSL)"
  if ! kubectl exec -n "$NS" -i kafka-0 -c kafka --request-timeout="${EXEC_TO}s" -- bash -s >/dev/null 2>&1 <<'EOSCRIPT'
set -euo pipefail
TS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS")
PROP=/tmp/och-kafka-ritual-api.props
{
  echo "security.protocol=SSL"
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=$TS"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=$KS"
  echo "ssl.key.password=$KP"
  echo "ssl.endpoint.identification.algorithm="
} > "$PROP"
kafka-broker-api-versions --bootstrap-server kafka:9093 --command-config "$PROP" >/dev/null
rm -f "$PROP"
EOSCRIPT
  then
    bad "kafka-broker-api-versions against kafka:9093 failed"
    exit 1
  fi
  ok "Broker API versions OK on headless kafka:9093 (SSL)"
else
  say "Phase 6a2c5 — skipped (VERIFY_KAFKA_SKIP_BROKER_API_GATE=1)"
fi

if [[ "${VERIFY_KAFKA_INCLUDE_GATEWAY_NC:-0}" == "1" ]]; then
  say "Optional — nc kafka:9093 from api-gateway pod"
  _gw_pod="$(kubectl get pods -n "$NS" -l app=api-gateway --request-timeout=25s -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$_gw_pod" ]]; then
    bad "VERIFY_KAFKA_INCLUDE_GATEWAY_NC=1 but no api-gateway pod found in $NS"
    exit 1
  fi
  kubectl exec -n "$NS" "$_gw_pod" --request-timeout="${EXEC_TO}s" -- \
    sh -c 'command -v nc >/dev/null 2>&1 && nc -vz -w 5 kafka 9093' >/dev/null 2>&1 || {
    bad "nc -vz kafka 9093 from $_gw_pod failed (install nc in image or drop VERIFY_KAFKA_INCLUDE_GATEWAY_NC)"
    exit 1
  }
  ok "api-gateway → kafka:9093 reachable"
fi

say "Kafka cluster verification PASSED"
