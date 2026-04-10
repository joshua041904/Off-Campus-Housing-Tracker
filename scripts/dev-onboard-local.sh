#!/usr/bin/env bash
# Strict local (Colima/k3s + MetalLB) dev-onboard orchestration: set -euo pipefail, no silent success.
#
# Prevents app CrashLoop when Secret/och-kafka-ssl-secret is missing or incomplete (auth-service,
# analytics-service, etc. mount /etc/kafka/secrets/ca-cert.pem, client.crt, client.key for Kafka mTLS).
#
# Deterministic contract (gates before later phases):
#   Toolchain: Phase 0.25 make deps (pnpm for ensure-dev-root / reissue before Phase 0.5).
#   TLS: Phase 0.5 local dev-root CA (dev-onboard-zero-trust-preflight) before make up-fast;
#        defer Kafka JKS until LB (TLS_FIRST_TIME_DEFER_KAFKA_JKS); reissue syncs och-service-tls (reissue step 2c);
#        Phase 3.5 ensure-housing-cluster-secrets + verify och-kafka-ssl-secret PEM keys right after apply-kafka-kraft;
#        Phase 5 kafka-tls-guard + 5a ensure-housing-cluster-secrets (idempotent) + 5a1 service-tls-alias-guard.
#   Kafka: Phase 5a2 kafka-quorum-stable (no QuorumController "leader is (none)" in window).
#   Edge: Phase 5b deferred rollouts; Phase 7b edge-readiness-gate (MetalLB + Caddy + gateway /healthz + /readyz).
#   Post-edge: Phase 10 default KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite (full alignment + auto inter-broker TLS heal via Makefile).
#   DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY=1 → make kafka-health instead. SKIP_KAFKA_HEALTH_ON_ONBOARD=1 skips Phase 10 entirely.
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

# Exit 0 iff Secret/och-kafka-ssl-secret has non-empty data for ca-cert.pem, client.crt, client.key.
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

if [[ -n "${RESTORE_BACKUP_DIR:-}" ]]; then
  echo "▶ Phase 0: Docker Compose + 7 Postgres — restore from dumps only (no infra/db SQL here)"
  export SKIP_BOOTSTRAP=1
  bash "$SCRIPT_DIR/bring-up-external-infra.sh"
else
  echo "▶ Phase 0: skipped (RESTORE_BACKUP_DIR empty — infra-cluster may run SQL bootstrap)"
fi

echo "▶ Phase 0.25: Workspace deps (pnpm install — required before dev-root / reissue in Phase 0.5)"
make deps

echo "▶ Phase 0.5: Zero-trust TLS — local dev-root CA before cluster (Kafka / mTLS signing chain)"
chmod +x "$SCRIPT_DIR/dev-onboard-zero-trust-preflight.sh"
bash "$SCRIPT_DIR/dev-onboard-zero-trust-preflight.sh"

echo "▶ Phase 1: Base cluster + TLS + host infra (deps already done — up-fast; no app Deployment restarts in reissue; RESTORE cleared for this make)"
export SKIP_AUTO_RESTORE=1
RESTORE_BACKUP_DIR= make up-fast

echo "▶ Phase 2: Kafka Service reset (LB + headless)"
make kafka-onboarding-reset

echo "▶ Phase 3: Kafka Services + atomic TLS refresh (scale-0 → full JKS regen → brokers up; Parallel SS policy kept for KRaft DNS bootstrap)"
make apply-kafka-kraft

echo "▶ Phase 3.5: Housing secrets — sync och-kafka-ssl-secret (app Kafka mTLS PEMs) + verify keys"
chmod +x "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
_NS="${HOUSING_NS:-off-campus-housing-tracker}"
HOUSING_NS="$_NS" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
if ! _verify_och_kafka_pem_secret "$_NS"; then
  echo "▶ Phase 3.5 remediate: kafka-ssl-from-dev-root.sh + re-sync (broker PEM material → och-kafka-ssl-secret)"
  chmod +x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
  KAFKA_SSL_NS="$_NS" bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
  if kubectl get sts kafka -n "$_NS" --request-timeout=20s >/dev/null 2>&1; then
    echo "  ▶ rollout restart statefulset/kafka (brokers remount kafka-ssl-secret)"
    kubectl rollout restart statefulset/kafka -n "$_NS" --request-timeout=30s
    kubectl rollout status statefulset/kafka -n "$_NS" --timeout=480s
  fi
  HOUSING_NS="$_NS" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
  if ! _verify_och_kafka_pem_secret "$_NS"; then
    echo "❌ och-kafka-ssl-secret still incomplete — check kubectl context, namespace $_NS, and certs/dev-root.{pem,key}" >&2
    exit 1
  fi
fi

echo "▶ Phase 4: Kafka DNS + topic preflight + bootstrap"
make onboarding-kafka-preflight

echo "▶ Phase 5: Kafka TLS guard (mounted CA + JKS uniformity, service-tls↔Kafka CA, PKIX logs) + verify-kafka-cluster — abort onboard if this fails"
make kafka-tls-guard

echo "▶ Phase 5a: Re-sync och-service-tls / och-kafka aliases (idempotent; after TLS guard churn)"
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

# Post-edge Kafka: Makefile runs kafka-auto-heal-inter-broker-tls before alignment / verify (fixes PKIX / mixed truststore after partial restarts).
if [[ "${SKIP_KAFKA_HEALTH_ON_ONBOARD:-0}" == "1" ]]; then
  echo "▶ Phase 10: skipped (SKIP_KAFKA_HEALTH_ON_ONBOARD=1)"
elif [[ "${DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY:-0}" == "1" ]]; then
  echo "▶ Phase 10: Kafka health + runtime-sync + safe alignment slice (DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY=1 → make kafka-health)"
  make kafka-health
else
  echo "▶ Phase 10: full Kafka alignment suite (KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite; auto TLS heal via Makefile)"
  KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite
fi

_DEV_ONBOARD_T1="$(date +%s)"
_DEV_ONBOARD_SEC=$((_DEV_ONBOARD_T1 - _DEV_ONBOARD_T0))
echo ""
echo "✅ DEV ONBOARD COMPLETE — local cluster verified end-to-end (${_DEV_ONBOARD_SEC}s wall clock)."
