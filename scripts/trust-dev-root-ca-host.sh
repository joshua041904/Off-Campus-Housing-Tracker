#!/usr/bin/env bash
# Cross-platform dispatcher: install dev-root CA into the host OS trust store (macOS Keychain, Linux CA bundle, …).
# Invoked by bootstrap P1c+ and by `make trust-ca-host` / legacy `make trust-ca-macos`.
#
# Skip (any): BOOTSTRAP_SKIP_TRUST=1 | TRUST_DEV_ROOT_CA_SKIP=1 | BOOTSTRAP_SKIP_MACOS_TRUST=1
# Usage: bash scripts/trust-dev-root-ca-host.sh [/path/to/certs/dev-root.pem]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CA_FILE="${1:-${CA_FILE:-$REPO_ROOT/certs/dev-root.pem}}"
[[ "$CA_FILE" != /* ]] && CA_FILE="$REPO_ROOT/$CA_FILE"

info() { echo "ℹ️  $*"; }

if [[ "${BOOTSTRAP_SKIP_TRUST:-0}" == "1" ]] || [[ "${TRUST_DEV_ROOT_CA_SKIP:-0}" == "1" ]] || [[ "${BOOTSTRAP_SKIP_MACOS_TRUST:-0}" == "1" ]]; then
  info "BOOTSTRAP_SKIP_TRUST / TRUST_DEV_ROOT_CA_SKIP / BOOTSTRAP_SKIP_MACOS_TRUST — skipping host OS dev CA trust."
  exit 0
fi

case "$(uname -s)" in
  Darwin)
    exec bash "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" "$CA_FILE"
    ;;
  Linux)
    exec bash "$SCRIPT_DIR/trust-dev-root-ca-linux.sh" "$CA_FILE"
    ;;
  *)
    info "$(uname -s): no automated dev-root trust — use SSL_CERT_FILE=$CA_FILE or install the PEM in your OS store manually."
    exit 0
    ;;
esac
