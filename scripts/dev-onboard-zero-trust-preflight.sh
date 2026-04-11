#!/usr/bin/env bash
# First step of local dev-onboard (before make up): ensure the dev-root CA exists on disk.
# Kafka broker/client TLS and strict mTLS services are signed from this chain; without it,
# tls-first-time / kafka-refresh cannot produce kafka-ssl-secret or och-kafka-ssl-secret.
#
# Cluster-agnostic — safe before Colima/k3s. Does not kubectl apply.
#
# Usage: ./scripts/dev-onboard-zero-trust-preflight.sh
# Env: same as scripts/ensure-dev-root-ca.sh (e.g. KAFKA_REMEDIATE_SKIP_REISSUE=1 to fail if CA missing)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Zero-trust TLS preflight (local CA before cluster) ==="
echo "  After Kafka TLS refresh, dev-onboard syncs Secret/och-kafka-ssl-secret (keys: ca-cert.pem, client.crt, client.key) for app pods."
chmod +x "$SCRIPT_DIR/ensure-dev-root-ca.sh"
bash "$SCRIPT_DIR/ensure-dev-root-ca.sh"
echo "✅ certs/dev-root.pem + dev-root.key present — continuing to cluster / TLS bootstrap"
