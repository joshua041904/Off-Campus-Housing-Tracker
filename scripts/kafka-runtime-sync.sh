#!/usr/bin/env bash
# Kafka ↔ MetalLB runtime alignment: LB IP vs advertised EXTERNAL + broker TLS SAN vs LB IPs.
#
# Usage:
#   ./scripts/kafka-runtime-sync.sh [--check-only|--remediate] [--quiet] [--skip-tls-sans] [namespace] [replicas]
# Env: HOUSING_NS, KAFKA_BROKER_REPLICAS, DRIFT_WRITE_PROM_FILE (forwarded to check-kafka-config-drift)
#
# --check-only (default): exit 0 only if no advertised drift and (unless --skip-tls-sans) TLS SANs match LB IPs.
# --remediate:          refresh TLS from LB, rollout restart kafka StatefulSet, run verify-kafka-cluster.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="check"
QUIET=0
SKIP_TLS=0
POS_NS=""
POS_REP=""

usage() {
  sed -n '1,20p' "$0" | tail -n +2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only) MODE="check"; shift ;;
    --remediate) MODE="remediate"; shift ;;
    --quiet) QUIET=1; shift ;;
    --skip-tls-sans) SKIP_TLS=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *)
      if [[ -z "$POS_NS" ]]; then
        POS_NS="$1"
      elif [[ -z "$POS_REP" ]]; then
        POS_REP="$1"
      else
        echo "Unknown arg: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

NS="${POS_NS:-${HOUSING_NS:-off-campus-housing-tracker}}"
REP="${POS_REP:-${KAFKA_BROKER_REPLICAS:-3}}"

_run_advert_check() {
  export HOUSING_NS="$NS"
  export KAFKA_BROKER_REPLICAS="$REP"
  if [[ "$QUIET" == "1" ]]; then
    bash "$SCRIPT_DIR/check-kafka-config-drift.sh" "$NS" "$REP" >/dev/null 2>&1
  else
    bash "$SCRIPT_DIR/check-kafka-config-drift.sh" "$NS" "$REP"
  fi
}

_run_tls_check() {
  export HOUSING_NS="$NS"
  export KAFKA_BROKER_REPLICAS="$REP"
  if [[ "$QUIET" == "1" ]]; then
    bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$NS" "$REP" >/dev/null 2>&1
  else
    bash "$SCRIPT_DIR/verify-kafka-tls-sans.sh" "$NS" "$REP"
  fi
}

if [[ "$MODE" == "check" ]]; then
  adv_ok=0
  set +e
  _run_advert_check
  adv_ok=$?
  set -e
  if [[ "$adv_ok" -ne 0 ]]; then
    [[ "$QUIET" == "1" ]] && echo "❌ kafka-runtime-sync: advertised.listeners vs LB drift (ns=$NS)" >&2
    exit 1
  fi

  if [[ "$SKIP_TLS" != "1" ]]; then
    tls_ok=0
    set +e
    _run_tls_check
    tls_ok=$?
    set -e
    if [[ "$tls_ok" -ne 0 ]]; then
      [[ "$QUIET" == "1" ]] && echo "❌ kafka-runtime-sync: TLS SAN vs MetalLB LB IP mismatch (ns=$NS)" >&2
      exit 1
    fi
  fi

  if [[ "$QUIET" != "1" ]]; then
    if [[ "$SKIP_TLS" == "1" ]]; then
      echo "✅ kafka-runtime-sync: no advertised drift (TLS SAN check skipped)"
    else
      echo "✅ kafka-runtime-sync: no drift (advertised + TLS SAN)"
    fi
  fi
  exit 0
fi

# --- remediate ---
echo "=== kafka-runtime-sync --remediate (ns=$NS replicas=$REP) ==="
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-refresh-tls-from-lb.sh"

echo "▶ Verifying broker JKS before Kafka rollout (PrivateKeyEntry + serverAuth + clientAuth EKU)…"
chmod +x "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" 2>/dev/null || true
REPO_ROOT="$REPO_ROOT" \
  KAFKA_KEYSTORE_PATH="$REPO_ROOT/certs/kafka-ssl/kafka.keystore.jks" \
  KAFKA_KEYSTORE_PASSWORD_FILE="$REPO_ROOT/certs/kafka-ssl/kafka.keystore-password" \
  bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" || {
  echo "❌ Broker keystore verification failed — aborting rollout (fix certs/kafka-ssl or kafka-ssl-from-dev-root)" >&2
  exit 1
}

echo "▶ Rolling Kafka StatefulSet…"
kubectl rollout restart statefulset/kafka -n "$NS" --request-timeout=30s
_rollout_to="${KAFKA_REMEDIATE_ROLLOUT_TIMEOUT:-${KAFKA_ROLLOUT_TIMEOUT:-600s}}"
kubectl rollout status statefulset/kafka -n "$NS" --timeout="$_rollout_to"

chmod +x "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" 2>/dev/null || true
HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-after-rollout-verify-brokers.sh" || {
  echo "❌ Post-rollout broker TLS parity / Ready check failed (see kafka-tls-guard / PKIX logs above)" >&2
  exit 1
}

echo "▶ Post-rollout drift / SAN check…"
if ! HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" bash "$SCRIPT_DIR/kafka-runtime-sync.sh" --check-only "$NS" "$REP"; then
  echo "❌ kafka-runtime-sync --check-only failed after remediate rollout" >&2
  exit 1
fi

chmod +x "$SCRIPT_DIR/verify-kafka-cluster.sh" 2>/dev/null || true
VERIFY_KAFKA_HEALTH_ONLY=0 \
  VERIFY_KAFKA_SKIP_META_IDENTITY=0 \
  VERIFY_KAFKA_SKIP_TLS_SANS=0 \
  VERIFY_KAFKA_SKIP_ADVERTISED=0 \
  VERIFY_KAFKA_SKIP_TLS_CONSISTENCY=0 \
  VERIFY_KAFKA_SKIP_QUORUM_GATE=0 \
  VERIFY_KAFKA_SKIP_LEADERSHIP_CHURN_GATE=0 \
  VERIFY_KAFKA_SKIP_BROKER_API_GATE=0 \
  HOUSING_NS="$NS" KAFKA_BROKER_REPLICAS="$REP" \
  bash "$SCRIPT_DIR/verify-kafka-cluster.sh" "$NS" "$REP" || {
  echo "❌ verify-kafka-cluster failed after remediate" >&2
  exit 1
}

echo "✅ Auto-remediation successful."
echo "✅ kafka-runtime-sync --remediate complete"
