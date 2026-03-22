#!/usr/bin/env bash
# Add the dev-root CA to macOS keychain so k6, curl, and browsers trust https://off-campus-housing.test (avoids x509 and manual Keychain Access).
# Call after rotation syncs certs/dev-root.pem, or before any step that hits off-campus-housing.test with TLS.
# Usage: [CA_FILE=/path/to/certs/dev-root.pem] source scripts/lib/trust-dev-root-ca-macos.sh
#        or: ./scripts/lib/trust-dev-root-ca-macos.sh /path/to/certs/dev-root.pem

set -euo pipefail

# Resolve CA file (arg or env or default)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CA_FILE="${1:-${CA_FILE:-$REPO_ROOT/certs/dev-root.pem}}"
[[ "$CA_FILE" != /* ]] && CA_FILE="$REPO_ROOT/$CA_FILE"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  info "Not macOS; skip keychain trust step (SSL_CERT_FILE is enough for k6 on Linux)."
  exit 0
fi

if [[ ! -f "$CA_FILE" ]] || [[ ! -s "$CA_FILE" ]]; then
  warn "CA file missing or empty: $CA_FILE — cannot add to keychain. Run rotation or preflight so certs/dev-root.pem exists."
  exit 1
fi

LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
SYSTEM_KEYCHAIN="/Library/Keychains/System.keychain"

# Remove any existing dev-root-ca cert(s) from login keychain so the new CA (after rotation) is the one trusted.
# find-certificate -c "dev-root-ca" matches CN like dev-root-ca-1234567890.
for _ in 1 2 3 4 5; do
  security find-certificate -c "dev-root-ca" -a "$LOGIN_KEYCHAIN" 2>/dev/null | grep -q . || break
  security delete-certificate -c "dev-root-ca" -k "$LOGIN_KEYCHAIN" 2>/dev/null || break
done

# Add current CA to login keychain as trusted for SSL (no sudo). This is the step that replaces opening Keychain Access manually.
if security add-trusted-cert -d -r trustRoot -k "$LOGIN_KEYCHAIN" "$CA_FILE" 2>/dev/null; then
  ok "Dev CA added to macOS login keychain (Always Trust for SSL). k6/curl/browser will trust off-campus-housing.test."
  exit 0
fi
if security add-trusted-cert -d -r trustAsRoot -k "$LOGIN_KEYCHAIN" "$CA_FILE" 2>/dev/null; then
  ok "Dev CA added to macOS login keychain (trustAsRoot). k6/curl/browser will trust off-campus-housing.test."
  exit 0
fi

# Optional: try System keychain with sudo (non-interactive). Succeeds only if sudo is available and passwordless.
if sudo -n true 2>/dev/null; then
  for _ in 1 2 3 4 5; do
    security find-certificate -c "dev-root-ca" -a "$SYSTEM_KEYCHAIN" 2>/dev/null | grep -q . || break
    sudo security delete-certificate -c "dev-root-ca" -k "$SYSTEM_KEYCHAIN" 2>/dev/null || break
  done
  if sudo -n security add-trusted-cert -d -r trustRoot -k "$SYSTEM_KEYCHAIN" "$CA_FILE" 2>/dev/null; then
    ok "Dev CA added to macOS System keychain (Always Trust for SSL)."
    exit 0
  fi
fi

warn "Could not add CA to keychain automatically. If k6 still shows x509, add manually:"
echo "   Keychain Access → File → Import Items → select $CA_FILE → double-click the cert → Trust → Always Trust"
echo "   Or: sudo security add-trusted-cert -d -r trustRoot -k $SYSTEM_KEYCHAIN $CA_FILE"
exit 1
