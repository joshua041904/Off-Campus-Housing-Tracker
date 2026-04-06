#!/usr/bin/env bash
# Kafka TLS drift enforcer: secret ↔ mounted CA, identical JKS across brokers, service-tls↔broker CA parity,
# och-kafka secret, logs, verify-kafka-cluster.
# Canonical TLS is always dev-root + kafka-ssl-from-dev-root.sh (never a second CA in-cluster).
#
# Env:
#   HOUSING_NS — default off-campus-housing-tracker
#   KAFKA_BROKER_REPLICAS — default 3
#   KAFKA_TLS_GUARD_SKIP_VERIFY — set 1 to skip make verify-kafka-cluster at end
#   KAFKA_TLS_GUARD_SKIP_LOG_SCAN — set 1 to skip recent SSL handshake failure grep
#   KAFKA_TLS_GUARD_POST_ROLLOUT_ONLY=1 — after full rollout: steps 1–5 (mount/JKS parity) + 7 (PKIX log tail);
#     skip 5b–6 (service-tls / och-kafka / annotation) and step 8 (verify-cluster)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
R="${KAFKA_BROKER_REPLICAS:-3}"

command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

_ca_fp_from_pem() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2
}

_stdin_sha256() {
  openssl dgst -sha256 2>/dev/null | awk '{print $2}'
}

_secret_ca_sha256() {
  kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca\.crt}' --request-timeout=25s | base64 -d | _stdin_sha256
}

_pod_file_sha256() {
  local pod="$1"
  local path="$2"
  kubectl exec -n "$NS" "$pod" -c kafka --request-timeout=60s -- \
    cat "$path" 2>/dev/null | _stdin_sha256
}

_truststore_keytool_sha256() {
  local pod="$1"
  local ts_pass
  ts_pass="$(kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.kafka\.truststore-password}' --request-timeout=20s | base64 -d | tr -d '\r\n')"
  kubectl exec -n "$NS" "$pod" -c kafka --request-timeout=60s -- \
    env TS_PASS="$ts_pass" bash -c 'keytool -list -keystore /etc/kafka/secrets/kafka.truststore.jks -storepass "$TS_PASS" 2>/dev/null' | _stdin_sha256
}

_nuniq_lines() {
  sort -u | awk 'NF' | wc -l | tr -d ' '
}

say "=== kafka-tls-guard (ns=$NS replicas=$R) ==="

if ! kubectl get secret kafka-ssl-secret -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
  bad "kafka-ssl-secret missing in $NS"
  exit 1
fi

if ! kubectl get sts kafka -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
  bad "StatefulSet kafka not found in $NS"
  exit 1
fi

_spec_rep="$(kubectl get sts kafka -n "$NS" -o jsonpath='{.spec.replicas}' --request-timeout=20s 2>/dev/null || echo "")"
if [[ -n "$_spec_rep" && "$_spec_rep" != "$R" ]]; then
  bad "StatefulSet kafka.spec.replicas=${_spec_rep} expected ${R}"
  exit 1
fi

declare -a pods=()
for ((i = 0; i < R; i++)); do
  pods+=("kafka-$i")
done

say "1) Pod readiness"
for p in "${pods[@]}"; do
  if ! kubectl wait --for=condition=ready "pod/$p" -n "$NS" --timeout=120s --request-timeout=30s; then
    bad "Pod $p not Ready in $NS"
    exit 1
  fi
done
ok "All broker pods Ready"

say "2) Secret ca.crt vs mounted ca.crt on each broker"
_secret_h="$(_secret_ca_sha256)"
if [[ -z "$_secret_h" ]]; then
  bad "Could not hash secret kafka-ssl-secret data.ca.crt"
  exit 1
fi
echo "   secret ca.crt sha256=$_secret_h"

for p in "${pods[@]}"; do
  _mh="$(_pod_file_sha256 "$p" /etc/kafka/secrets/ca.crt)"
  if [[ -z "$_mh" ]]; then
    bad "Could not read/hash /etc/kafka/secrets/ca.crt in $p"
    exit 1
  fi
  echo "   $p mounted ca.crt sha256=$_mh"
  if [[ "$_mh" != "$_secret_h" ]]; then
    bad "$p mounted ca.crt != secret (stale volume / partial secret update — run: make kafka-tls-rotate-atomic)"
    exit 1
  fi
done
ok "Mounted ca.crt matches secret on all brokers"

say "3) kafka.truststore.jks byte-identical on all brokers"
_ts_lines=""
for p in "${pods[@]}"; do
  h="$(_pod_file_sha256 "$p" /etc/kafka/secrets/kafka.truststore.jks)"
  if [[ -z "$h" ]]; then
    bad "Could not hash truststore in $p"
    exit 1
  fi
  echo "   $p truststore.jks sha256=$h"
  _ts_lines="${_ts_lines}${h}"$'\n'
done
if [[ "$(echo -n "$_ts_lines" | _nuniq_lines)" -ne 1 ]]; then
  bad "Truststore JKS drift across brokers (PKIX / trust anchor risk — run: make kafka-tls-rotate-atomic)"
  exit 1
fi
ok "Truststore JKS uniform"

say "4) keytool -list (truststore) identical across brokers"
_kt_lines=""
for p in "${pods[@]}"; do
  kh="$(_truststore_keytool_sha256 "$p")"
  if [[ -z "$kh" ]]; then
    bad "keytool -list hash failed in $p"
    exit 1
  fi
  echo "   $p keytool-list sha256=$kh"
  _kt_lines="${_kt_lines}${kh}"$'\n'
done
if [[ "$(echo -n "$_kt_lines" | _nuniq_lines)" -ne 1 ]]; then
  bad "Truststore keytool listing differs across brokers"
  exit 1
fi
ok "Truststore keytool listing uniform"

say "5) kafka.keystore.jks byte-identical on all brokers"
_ks_lines=""
for p in "${pods[@]}"; do
  h="$(_pod_file_sha256 "$p" /etc/kafka/secrets/kafka.keystore.jks)"
  if [[ -z "$h" ]]; then
    bad "Could not hash keystore in $p"
    exit 1
  fi
  echo "   $p keystore.jks sha256=$h"
  _ks_lines="${_ks_lines}${h}"$'\n'
done
if [[ "$(echo -n "$_ks_lines" | _nuniq_lines)" -ne 1 ]]; then
  bad "Keystore JKS drift across brokers"
  exit 1
fi
ok "Keystore JKS uniform"

if [[ "${KAFKA_TLS_GUARD_POST_ROLLOUT_ONLY:-0}" == "1" ]]; then
  say "POST_ROLLOUT_ONLY=1 — skipping service-tls / och-kafka / annotation gates (use full kafka-tls-guard for those)"
else

say "5b) service-tls ca.crt vs kafka-ssl-secret CA (single dev-root parity)"
if kubectl get secret service-tls -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  _st_fp="$(
    kubectl get secret service-tls -n "$NS" -o jsonpath='{.data.ca\.crt}' --request-timeout=25s | base64 -d | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2
  )"
  _kf_fp="$(
    kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2
  )"
  if [[ -z "$_st_fp" || -z "$_kf_fp" ]]; then
    bad "Could not fingerprint service-tls ca.crt and/or kafka-ssl-secret ca-cert.pem"
    exit 1
  fi
  echo "   service-tls ca.crt     SHA-256=$_st_fp"
  echo "   kafka-ssl-secret CA    SHA-256=$_kf_fp"
  if [[ "$_st_fp" != "$_kf_fp" ]]; then
    bad "service-tls CA != kafka broker CA (edge vs in-cluster Kafka drift — reissue + kafka-refresh-tls-from-lb)"
    exit 1
  fi
  ok "service-tls and kafka broker trust anchor match"

  say "5c) Mounted truststore alias dev-root-ca vs service-tls ca.crt (runtime JKS parity)"
  _ts_pass_pod="$(kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.kafka\.truststore-password}' --request-timeout=20s | base64 -d | tr -d '\r\n')"
  for p in "${pods[@]}"; do
    _alias_fp="$(
      kubectl exec -n "$NS" "$p" -c kafka --request-timeout=60s -- \
        env TS_PASS="$_ts_pass_pod" bash -c 'keytool -exportcert -alias dev-root-ca -keystore /etc/kafka/secrets/kafka.truststore.jks -storepass "$TS_PASS" -rfc 2>/dev/null' \
        | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2
    )"
    if [[ -z "$_alias_fp" ]]; then
      bad "Could not export dev-root-ca from truststore in $p"
      exit 1
    fi
    echo "   $p truststore dev-root-ca SHA-256=$_alias_fp"
    if [[ "$_alias_fp" != "$_st_fp" ]]; then
      bad "$p truststore CA != service-tls ca.crt (JKS vs edge drift — make kafka-tls-rotate-atomic)"
      exit 1
    fi
  done
  ok "Broker truststore dev-root-ca matches service-tls on all replicas"
else
  echo "   ℹ️  service-tls absent — skipped (Kafka-only check)"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
kubectl get secret kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$TMP/broker-ca.pem"
BROKER_FP="$(_ca_fp_from_pem "$TMP/broker-ca.pem")"

say "6) och-kafka-ssl-secret CA vs kafka-ssl-secret"
if kubectl get secret och-kafka-ssl-secret -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  kubectl get secret och-kafka-ssl-secret -n "$NS" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s | base64 -d >"$TMP/service-ca.pem"
  SERVICE_FP="$(_ca_fp_from_pem "$TMP/service-ca.pem")"
  if [[ -z "$BROKER_FP" || -z "$SERVICE_FP" || "$BROKER_FP" != "$SERVICE_FP" ]]; then
    bad "CA fingerprint mismatch kafka-ssl-secret vs och-kafka-ssl-secret (run: make kafka-refresh-tls-from-lb)"
    exit 1
  fi
  ok "Service client secret CA matches broker secret"
else
  echo "   ℹ️  och-kafka-ssl-secret absent — skipped"
fi

_ann="$(kubectl get secret kafka-ssl-secret -n "$NS" -o go-template='{{index .metadata.annotations "och.dev/ca-fingerprint-sha256"}}' 2>/dev/null | tr -d '\r' || true)"
if [[ -n "$_ann" && "$_ann" != "$BROKER_FP" ]]; then
  bad "Annotation och.dev/ca-fingerprint-sha256 != live CA PEM"
  exit 1
fi
[[ -n "$_ann" ]] && ok "Secret CA annotation consistent"

fi # end !POST_ROLLOUT_ONLY

if [[ "${KAFKA_TLS_GUARD_SKIP_LOG_SCAN:-0}" != "1" ]]; then
  say "7) Recent broker logs — SSL handshake / PKIX"
  for p in "${pods[@]}"; do
    if kubectl logs "$p" -n "$NS" -c kafka --request-timeout=45s --tail=250 2>/dev/null | grep -qiE 'SSL handshake failed|PKIX path validation failed'; then
      bad "SSL/PKIX errors in recent logs for $p"
      exit 1
    fi
  done
  ok "No recent SSL handshake / PKIX errors in log tail"
fi

if [[ "${KAFKA_TLS_GUARD_SKIP_VERIFY:-0}" != "1" ]]; then
  say "8) verify-kafka-cluster"
  # Default 0: guard often runs before app Deployments exist (dev-onboard).
  VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS="${VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS:-0}" \
    make -C "$REPO_ROOT" verify-kafka-cluster
fi

ok "kafka-tls-guard PASSED"
exit 0
