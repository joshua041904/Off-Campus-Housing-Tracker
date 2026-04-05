#!/usr/bin/env bash
# Strict local (Colima/k3s + MetalLB) dev-onboard orchestration: set -euo pipefail, no silent success.
#
# Deterministic contract (gates before later phases):
#   TLS: defer Kafka JKS until LB (TLS_FIRST_TIME_DEFER_KAFKA_JKS); reissue syncs och-service-tls (reissue step 2c);
#        Phase 5 kafka-tls-guard + 5a ensure-housing-cluster-secrets + 5a1 service-tls-alias-guard.
#   Kafka: Phase 5a2 kafka-quorum-stable (no QuorumController "leader is (none)" in window).
#   Edge: Phase 5b deferred rollouts; Phase 7b edge-readiness-gate (MetalLB + Caddy + gateway /healthz + /readyz).
# Destructive full reset (Kafka wipe + reissue chain): make dev-onboard-hardened-reset (not this script).
set -euo pipefail

_DEV_ONBOARD_T0="${DEV_ONBOARD_T0:-$(date +%s)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=== STRICT MODE AUDIT: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
if command -v kubectl >/dev/null 2>&1; then
  kubectl get pods -A --request-timeout=25s 2>&1 || echo "⚠️  kubectl get pods -A failed (no cluster or wrong context)"
else
  echo "⚠️  kubectl not in PATH"
fi

# RESTORE_BACKUP_DIR is passed from the Makefile (empty if unset in the calling environment).
# - Non-empty (e.g. latest): Phase 0 runs bring-up-external-infra with restore from backups/.
# - Empty: skip Phase-0 restore; infra-cluster / SQL bootstrap path (see docs).
# Do not default to "latest" here — Make always passes the variable, so empty must mean "no restore".

# Reissue must not rollout app Deployments until Kafka TLS is rolled + verified (Phase 5).
export RESTART_SERVICES_AFTER_TLS=0
# tls-first-time: Kafka JKS only after LB IPs (apply-kafka-kraft → kafka-refresh); Caddy after Kafka guard (Phase 5b).
export TLS_FIRST_TIME_DEFER_KAFKA_JKS=1
export REISSUE_SKIP_CADDY_ROLLOUT=1
# make up: skip edge HTTP/3 probe until Phase 5b restarts Caddy with new ingress TLS (otherwise verify-curl-http3 fails mid-onboard).
export SKIP_VERIFY_CURL_HTTP3=1
# Scale brokers to 0 before kafka-ssl-secret refresh so no mixed JKS/truststore across running pods.
export KAFKA_TLS_ATOMIC_BEFORE_REFRESH=1

# Hard defaults for green-or-red onboard (override only with explicit env).
if [[ "${DEV_ONBOARD_STRICT:-1}" == "1" ]]; then
  export VERIFY_KAFKA_SKIP_META_IDENTITY=0
  export VERIFY_KAFKA_HEALTH_ONLY=0
  export EDGE_HOSTS_STRICT=1
  export HOSTS_AUTO=1
  export METALLB_FIX_LENIENT=0
  export VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS=1
  # Longer per-deploy rollout wait during TLS churn (api-gateway often waits on Kafka).
  export OCH_ROLLOUT_STATUS_TIMEOUT="${OCH_ROLLOUT_STATUS_TIMEOUT:-300}"
else
  export VERIFY_KAFKA_SKIP_META_IDENTITY="${VERIFY_KAFKA_SKIP_META_IDENTITY:-0}"
  export VERIFY_KAFKA_HEALTH_ONLY="${VERIFY_KAFKA_HEALTH_ONLY:-0}"
  export EDGE_HOSTS_STRICT="${EDGE_HOSTS_STRICT:-1}"
  export HOSTS_AUTO="${HOSTS_AUTO:-1}"
  export METALLB_FIX_LENIENT="${METALLB_FIX_LENIENT:-1}"
fi

echo "=============================================================="
echo " DEV ONBOARD (LOCAL / STRICT)"
echo "   VERIFY_KAFKA_SKIP_META_IDENTITY=$VERIFY_KAFKA_SKIP_META_IDENTITY"
echo "   VERIFY_KAFKA_HEALTH_ONLY=$VERIFY_KAFKA_HEALTH_ONLY"
echo "   EDGE_HOSTS_STRICT=$EDGE_HOSTS_STRICT HOSTS_AUTO=$HOSTS_AUTO"
echo "=============================================================="

make() {
  command make -C "$REPO_ROOT" "$@"
}

if [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
  echo "▶ Phase 0: Docker Compose + 7 Postgres — restore from dumps only (no infra/db SQL here)"
  export SKIP_BOOTSTRAP=1
  bash "$SCRIPT_DIR/bring-up-external-infra.sh"
else
  echo "▶ Phase 0: skipped (RESTORE_BACKUP_DIR empty — infra-cluster may run SQL bootstrap)"
fi

echo "▶ Phase 1: Base cluster + TLS + host infra (no app Deployment restarts in reissue; RESTORE cleared for this make)"
export SKIP_AUTO_RESTORE=1
RESTORE_BACKUP_DIR= make up

echo "▶ Phase 2: Kafka Service reset (LB + headless)"
make kafka-onboarding-reset

echo "▶ Phase 3: Kafka Services + atomic TLS refresh (scale-0 → full JKS regen → brokers up; Parallel SS policy kept for KRaft DNS bootstrap)"
make apply-kafka-kraft

echo "▶ Phase 4: Kafka DNS + topic preflight + bootstrap"
make onboarding-kafka-preflight

echo "▶ Phase 5: Kafka TLS guard (mounted CA + JKS uniformity, service-tls↔Kafka CA, PKIX logs) + verify-kafka-cluster — abort onboard if this fails"
make kafka-tls-guard

echo "▶ Phase 5a: Sync och-service-tls / och-kafka aliases from canonical secrets (idempotent)"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"

echo "▶ Phase 5a1: service-tls ↔ och-service-tls CA fingerprint gate (alias drift fail-fast)"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/service-tls-alias-guard.sh"

echo "▶ Phase 5a2: Kafka quorum stability gate (no QuorumController 'leader is (none)' in recent window)"
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/kafka-quorum-stable.sh"

echo "▶ Phase 5b: Deferred edge/service TLS rollouts (housing apps → caddy-h3) after Kafka is canonical"
bash "$SCRIPT_DIR/rollout-deferred-after-kafka-tls.sh"

echo "▶ Phase 6: Deploy workloads"
SKIP_STRICT_ENVELOPE=1 bash "$SCRIPT_DIR/deploy-dev.sh"

echo "▶ Phase 6b: Verify app Deployments mount och-kafka-ssl-secret (KafkaJS CA trust)"
if [[ "${VERIFY_KAFKA_CHECK_CLIENT_DEPLOY_MOUNTS:-0}" == "1" ]]; then
  VERIFY_KAFKA_CLIENT_MOUNTS_ONLY=1 bash "$SCRIPT_DIR/verify-kafka-cluster.sh"
fi

echo "▶ Phase 6.5: Rollouts again so new Deployments pick up service-tls / trust stores"
bash "$SCRIPT_DIR/rollout-deferred-after-kafka-tls.sh"

echo "▶ Phase 7: Wait for Caddy LoadBalancer IP"
make wait-for-caddy-ip

echo "▶ Phase 7b: Edge invariants (MetalLB IP + Caddy + api-gateway /healthz in-cluster)"
NS_ING="${NS_ING:-ingress-nginx}" HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}" bash "$SCRIPT_DIR/edge-readiness-gate.sh"

echo "▶ Phase 8: /etc/hosts + resolver check"
make ensure-edge-hosts

echo "▶ Phase 9: Edge routing + HTTPS"
make onboarding-edge

_DEV_ONBOARD_T1="$(date +%s)"
_DEV_ONBOARD_SEC=$((_DEV_ONBOARD_T1 - _DEV_ONBOARD_T0))
echo ""
echo "✅ DEV ONBOARD COMPLETE — local cluster verified end-to-end (${_DEV_ONBOARD_SEC}s wall clock)."
