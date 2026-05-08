#!/usr/bin/env bash
# Cluster → Kafka → deploy → edge → Kafka alignment/health (local Colima/k3s path).
# Prerequisites: workspace deps, dev-root CA on disk, and (when invoked from dev-orchestrator) :dev images built+loaded.
# Called by: scripts/dev-onboard-local.sh, scripts/dev-orchestrator.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

make() {
  command make -C "$REPO_ROOT" "$@"
}

# Align with dev-onboard-local.sh (TLS deferral + strict gates).
export RESTART_SERVICES_AFTER_TLS="${RESTART_SERVICES_AFTER_TLS:-0}"
export TLS_FIRST_TIME_DEFER_KAFKA_JKS="${TLS_FIRST_TIME_DEFER_KAFKA_JKS:-1}"
export REISSUE_SKIP_CADDY_ROLLOUT="${REISSUE_SKIP_CADDY_ROLLOUT:-1}"
export SKIP_VERIFY_CURL_HTTP3="${SKIP_VERIFY_CURL_HTTP3:-1}"
export KAFKA_TLS_ATOMIC_BEFORE_REFRESH="${KAFKA_TLS_ATOMIC_BEFORE_REFRESH:-1}"

if [[ "${DEV_ONBOARD_STRICT:-1}" == "1" ]]; then
  export VERIFY_KAFKA_SKIP_META_IDENTITY=0
  export VERIFY_KAFKA_HEALTH_ONLY=0
  export EDGE_HOSTS_STRICT=1
  export HOSTS_AUTO=1
  export METALLB_FIX_LENIENT=0
  export VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS=1
  export OCH_ROLLOUT_STATUS_TIMEOUT="${OCH_ROLLOUT_STATUS_TIMEOUT:-300}"
else
  export VERIFY_KAFKA_SKIP_META_IDENTITY="${VERIFY_KAFKA_SKIP_META_IDENTITY:-0}"
  export VERIFY_KAFKA_HEALTH_ONLY="${VERIFY_KAFKA_HEALTH_ONLY:-0}"
  export EDGE_HOSTS_STRICT="${EDGE_HOSTS_STRICT:-1}"
  export HOSTS_AUTO="${HOSTS_AUTO:-1}"
  export METALLB_FIX_LENIENT="${METALLB_FIX_LENIENT:-1}"
fi

_verify_och_kafka_pem_secret() {
  local ns="$1"
  python3 -c "
import json, subprocess, sys
ns = sys.argv[1]
r = subprocess.run(
    ['kubectl', '-n', ns, 'get', 'secret', 'och-kafka-ssl-secret', '-o', 'json', '--request-timeout=25s'],
    capture_output=True,
    text=True,
)
if r.returncode != 0:
    sys.exit(1)
data = json.loads(r.stdout).get('data') or {}
for k in ('ca-cert.pem', 'client.crt', 'client.key'):
    if k not in data or not (data[k] or '').strip():
        sys.exit(1)
print('  ✅ och-kafka-ssl-secret verified (ca-cert.pem, client.crt, client.key)')
" "$ns"
}

_DEV_ONBOARD_T0="${DEV_ONBOARD_T0:-$(date +%s)}"

echo "▶ Phase 1: Base cluster + TLS + host infra (make up-fast)"
# RESTORE_BACKUP_DIR / SKIP_BOOTSTRAP / SKIP_AUTO_RESTORE come from dev-orchestrator (Phase 1 dump restore contract).
make up-fast

echo "▶ Phase 2: Kafka Service reset (LB + headless)"
make kafka-onboarding-reset

echo "▶ Phase 3: Kafka Services + atomic TLS refresh"
make apply-kafka-kraft

echo "▶ Phase 3.5: Housing secrets — sync och-kafka-ssl-secret + verify keys"
chmod +x "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
_NS="${HOUSING_NS:-off-campus-housing-tracker}"
HOUSING_NS="$_NS" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
if ! _verify_och_kafka_pem_secret "$_NS"; then
  echo "▶ Phase 3.5 remediate: kafka-ssl-from-dev-root.sh + re-sync"
  chmod +x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
  KAFKA_SSL_NS="$_NS" bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
  if kubectl get sts kafka -n "$_NS" --request-timeout=20s >/dev/null 2>&1; then
    echo "  ▶ rollout restart statefulset/kafka"
    kubectl rollout restart statefulset/kafka -n "$_NS" --request-timeout=30s
    kubectl rollout status statefulset/kafka -n "$_NS" --timeout=480s
  fi
  HOUSING_NS="$_NS" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
  if ! _verify_och_kafka_pem_secret "$_NS"; then
    echo "❌ och-kafka-ssl-secret still incomplete — check context, namespace $_NS, certs/dev-root.{pem,key}" >&2
    exit 1
  fi
fi

# verify-kafka-bootstrap reads ConfigMap app-config.data.KAFKA_BROKER; deploy-dev.sh used to apply this
# only in Phase 6 — ensure it exists before Kafka onboarding preflight.
echo "▶ Phase 3.75: ConfigMap app-config (KAFKA_BROKER + DB URLs for later deploy)"
if [[ -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" ]]; then
  kubectl apply -f "$REPO_ROOT/infra/k8s/base/config/app-config.yaml" -n "$_NS" --request-timeout=45s
fi

echo "▶ Phase 4: Kafka DNS + topic preflight + bootstrap"
make onboarding-kafka-preflight

echo "▶ Phase 5: Kafka TLS guard + verify-kafka-cluster"
make kafka-tls-guard

echo "▶ Phase 5a: Re-sync housing cluster secrets"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"

echo "▶ Phase 5a1: service-tls alias gate"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/service-tls-alias-guard.sh"

echo "▶ Phase 5a2: Kafka quorum stability"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/kafka-quorum-stable.sh"

echo "▶ Phase 5b: Deferred edge/service TLS rollouts"
bash "$SCRIPT_DIR/rollout-deferred-after-kafka-tls.sh"

echo "▶ Phase 6: Deploy workloads"
SKIP_STRICT_ENVELOPE=1 bash "$SCRIPT_DIR/deploy-dev.sh"

echo "▶ Phase 6a: Observability stack — Jaeger, OTel collector, Prometheus, Grafana (wait Available)"
if [[ "${SKIP_OBSERVABILITY_WAIT:-0}" != "1" ]]; then
  chmod +x "$SCRIPT_DIR/ensure-observability-stack-ready.sh"
  bash "$SCRIPT_DIR/ensure-observability-stack-ready.sh"
else
  echo "  (skipped SKIP_OBSERVABILITY_WAIT=1)"
fi

echo "▶ Phase 6b: Verify app Deployments mount och-kafka-ssl-secret (optional)"
if [[ "${VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS:-0}" == "1" ]]; then
  VERIFY_KAFKA_CLIENT_MOUNTS_ONLY=1 bash "$SCRIPT_DIR/verify-kafka-cluster.sh"
fi

echo "▶ Phase 6.5: Rollouts again (service-tls / trust stores)"
bash "$SCRIPT_DIR/rollout-deferred-after-kafka-tls.sh"

echo "▶ Phase 7: Wait for Caddy LoadBalancer IP"
make wait-for-caddy-ip

echo "▶ Phase 7b: Edge invariants"
NS_ING="${NS_ING:-ingress-nginx}" HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/edge-readiness-gate.sh"

echo "▶ Phase 8: /etc/hosts + resolver"
make ensure-edge-hosts

echo "▶ Phase 9: Edge routing + HTTPS"
make onboarding-edge

if [[ "${SKIP_KAFKA_HEALTH_ON_ONBOARD:-0}" == "1" ]]; then
  echo "▶ Phase 10: skipped (SKIP_KAFKA_HEALTH_ON_ONBOARD=1)"
elif [[ "${DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY:-0}" == "1" ]]; then
  echo "▶ Phase 10: make kafka-health"
  make kafka-health
else
  echo "▶ Phase 10: Kafka alignment suite"
  KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite
fi

_DEV_ONBOARD_T1="$(date +%s)"
_DEV_ONBOARD_SEC=$((_DEV_ONBOARD_T1 - _DEV_ONBOARD_T0))
echo ""
echo "✅ DEV CLUSTER PATH COMPLETE (${_DEV_ONBOARD_SEC}s wall clock)."
echo "   (Started from make up-fast — see scripts/dev-onboard-local.sh / dev-orchestrator.sh)"
