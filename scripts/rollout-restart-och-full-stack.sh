#!/usr/bin/env bash
# Full-stack ordered rollout: refresh housing Secrets (Kafka client PEM alias, service-tls mirrors),
# then restart every OCH app Deployment and caddy-h3 so pods remount Secrets.
#
# Use when:
#   - Kafka TLS was fixed (kafka-ssl-from-dev-root.sh) but pods still see empty /etc/kafka/secrets
#   - Any Secret used as a volume changed (Kubernetes does not remount live)
#   - You want one command instead of ad-hoc per-service rollout restart
#
# Order: auth → listings → booking → messaging → trust → analytics → media → notification →
#   api-gateway → caddy-h3 (see scripts/lib/och-sequential-rollout.sh).
#
# Env:
#   HOUSING_NS — default off-campus-housing-tracker
#   NS_ING — default ingress-nginx
#   SKIP_ENSURE_CLUSTER_SECRETS=1 — skip ensure-housing-cluster-secrets.sh (rollout only)
#   OCH_ROLLOUT_STATUS_TIMEOUT — seconds per rollout status (default 180)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

export HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
export NS_ING="${NS_ING:-ingress-nginx}"

echo "=== rollout-restart-och-full-stack (ns=$HOUSING_NS, ingress=$NS_ING) ==="

if [[ "${SKIP_ENSURE_CLUSTER_SECRETS:-0}" != "1" ]]; then
  echo "▶ ensure-housing-cluster-secrets (och-kafka-ssl-secret + och-service-tls aliases)"
  HOUSING_NS="$HOUSING_NS" bash "$SCRIPT_DIR/ensure-housing-cluster-secrets.sh"
else
  echo "▶ skip ensure-housing-cluster-secrets (SKIP_ENSURE_CLUSTER_SECRETS=1)"
fi

echo "▶ ordered rollout: all housing Deployments, then caddy-h3"
bash "$SCRIPT_DIR/rollout-deferred-after-kafka-tls.sh"

echo "✅ rollout-restart-och-full-stack complete"
