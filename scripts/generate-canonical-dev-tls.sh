#!/usr/bin/env bash
# Single ordered entrypoint for dev TLS: CA + leaf reissue, Envoy client cert, strict bootstrap, optional Kafka JKS.
# Preserves the onboarding contract (defer Kafka JKS until LB IPs when TLS_FIRST_TIME_DEFER_KAFKA_JKS=1).
#
# Order (do not reorder without updating dev-onboard / make up):
#   1. reissue-ca-and-leaf-load-all-services.sh  — certs on disk + cluster secrets (service-tls, dev-root-ca, …)
#   2. generate-envoy-client-cert.sh            — mTLS client identity for Envoy (needs dev-root.key from 1)
#   3. strict-tls-bootstrap.sh                  — leaf / dev-root / service-tls secrets in both namespaces
#   4. kafka-ssl-from-dev-root.sh               — unless TLS_FIRST_TIME_DEFER_KAFKA_JKS=1 (dev-onboard defers to apply-kafka-kraft)
#
# Env (passthrough): KAFKA_SSL, RESTART_SERVICES, REISSUE_SKIP_CADDY_ROLLOUT, TLS_FIRST_TIME_DEFER_KAFKA_JKS, HOST, …
# Modes:
#   CANONICAL_TLS_REISSUE_ONLY=1 — run step 1 only (dev-onboard-hardened-reset before Kafka re-apply)
#
# Legacy: make tls-first-time and individual scripts remain available; this script is the supported orchestration path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:${SCRIPT_DIR}/shims:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

if [[ "${CANONICAL_TLS_REISSUE_ONLY:-0}" == "1" ]]; then
  say "=== Canonical dev TLS (reissue-only) ==="
  bash "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh"
  say "=== Canonical dev TLS (reissue-only) complete ==="
  exit 0
fi

say "=== Canonical dev TLS (full ordered chain) ==="
bash "$SCRIPT_DIR/reissue-ca-and-leaf-load-all-services.sh"
bash "$SCRIPT_DIR/generate-envoy-client-cert.sh"
bash "$SCRIPT_DIR/strict-tls-bootstrap.sh"
if [[ "${TLS_FIRST_TIME_DEFER_KAFKA_JKS:-0}" == "1" ]]; then
  echo "ℹ️  TLS_FIRST_TIME_DEFER_KAFKA_JKS=1 — skipping kafka-ssl-from-dev-root.sh (Kafka JKS after LB via apply-kafka-kraft / kafka-refresh-tls-from-lb)"
else
  bash "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh"
fi
say "=== Canonical dev TLS complete ==="
