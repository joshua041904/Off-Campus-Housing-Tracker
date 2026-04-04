#!/usr/bin/env bash
# Housing app Deployments then Caddy — same ordering as reissue step 7 + caddy last.
# Use after Kafka TLS guard when REISSUE_SKIP_CADDY_ROLLOUT=1 and RESTART_SERVICES=0 during tls-first-time.
#
# Env: HOUSING_NS, NS_ING (default ingress-nginx), OCH_ROLLOUT_STATUS_TIMEOUT
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/och-sequential-rollout.sh
source "$SCRIPT_DIR/lib/och-sequential-rollout.sh"

och_kubectl() {
  kubectl --request-timeout=25s "$@"
}

export OCH_ROLLOUT_NS="${HOUSING_NS:-off-campus-housing-tracker}"
export NS_ING="${NS_ING:-ingress-nginx}"

echo "=== rollout-deferred-after-kafka-tls (ns=$OCH_ROLLOUT_NS) ==="
och_rollout_ordered_housing_apps
och_rollout_caddy_last
echo "✅ rollout-deferred-after-kafka-tls complete"
