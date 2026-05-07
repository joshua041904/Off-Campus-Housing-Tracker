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

export DEV_ONBOARD_T0="${DEV_ONBOARD_T0:-$_DEV_ONBOARD_T0}"
chmod +x "$SCRIPT_DIR/dev-onboard-from-up-fast.sh"
bash "$SCRIPT_DIR/dev-onboard-from-up-fast.sh"

_DEV_ONBOARD_T1="$(date +%s)"
_DEV_ONBOARD_SEC=$((_DEV_ONBOARD_T1 - _DEV_ONBOARD_T0))
echo ""
echo "✅ DEV ONBOARD COMPLETE — local cluster verified end-to-end (${_DEV_ONBOARD_SEC}s wall clock)."
echo "   Observability: Jaeger UI (port-forward) + OTEL env — see docs/onboarding-observability.md and docs/tracing-booking-flow.md"
