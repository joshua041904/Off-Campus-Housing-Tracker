#!/usr/bin/env bash
# Ensure certs/dev-root.pem and certs/dev-root.key exist for Kafka TLS signing.
# If either is missing, runs: KAFKA_SSL=1 pnpm run reissue (from repo root).
#
# Usage: ./scripts/ensure-dev-root-ca.sh [REPO_ROOT]
# Env:
#   KAFKA_REMEDIATE_SKIP_REISSUE=1 — do not run reissue; exit 1 if CA files missing (CI / air-gapped)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PEM="$REPO_ROOT/certs/dev-root.pem"
KEY="$REPO_ROOT/certs/dev-root.key"

if [[ -f "$PEM" && -f "$KEY" ]]; then
  exit 0
fi

if [[ "${KAFKA_REMEDIATE_SKIP_REISSUE:-0}" == "1" ]]; then
  echo "❌ dev-root CA missing ($PEM / $KEY) and KAFKA_REMEDIATE_SKIP_REISSUE=1 — cannot bootstrap" >&2
  exit 1
fi

echo "▶ dev-root CA missing; running KAFKA_SSL=1 pnpm run reissue from $REPO_ROOT …"
cd "$REPO_ROOT"
command -v pnpm >/dev/null 2>&1 || {
  echo "❌ pnpm required on PATH to bootstrap dev-root CA (install Node/pnpm or place certs manually)" >&2
  exit 1
}
KAFKA_SSL=1 pnpm run reissue

if [[ ! -f "$PEM" || ! -f "$KEY" ]]; then
  echo "❌ reissue finished but dev-root.pem / dev-root.key still missing under $REPO_ROOT/certs/" >&2
  exit 1
fi
echo "✅ dev-root CA available after reissue"
