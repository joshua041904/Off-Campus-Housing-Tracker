#!/usr/bin/env bash
# Install dev-root CA into the Linux system trust store (Debian/Ubuntu/WSL or RHEL-family).
# Requires root or passwordless sudo for system paths. Without sudo, prints one-shot commands and exits 0.
#
# Skip: TRUST_DEV_ROOT_CA_SKIP=1 | BOOTSTRAP_SKIP_TRUST=1 | BOOTSTRAP_SKIP_MACOS_TRUST=1 (compat)
# Usage: bash scripts/trust-dev-root-ca-linux.sh [/abs/or/rel/path/to/dev-root.pem]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CA_FILE="${1:-${CA_FILE:-$REPO_ROOT/certs/dev-root.pem}}"
[[ "$CA_FILE" != /* ]] && CA_FILE="$REPO_ROOT/$CA_FILE"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }
info() { echo "ℹ️  $*"; }

if [[ "$(uname -s)" != "Linux" ]]; then
  info "Not Linux — skipping system CA install (use scripts/trust-dev-root-ca-host.sh from the dispatcher)."
  exit 0
fi

if [[ "${BOOTSTRAP_SKIP_TRUST:-0}" == "1" ]] || [[ "${TRUST_DEV_ROOT_CA_SKIP:-0}" == "1" ]] || [[ "${BOOTSTRAP_SKIP_MACOS_TRUST:-0}" == "1" ]]; then
  info "Trust skip env set — skipping Linux system CA install."
  exit 0
fi

if [[ ! -f "$CA_FILE" ]] || [[ ! -s "$CA_FILE" ]]; then
  warn "CA file missing or empty: $CA_FILE"
  exit 1
fi

_run_debian() {
  local dest_dir="$1"
  local dest="$dest_dir/dev-root-och.crt"
  if [[ "$(id -u)" -eq 0 ]]; then
    install -d -m 0755 "$dest_dir"
    install -m 0644 "$CA_FILE" "$dest"
    update-ca-certificates
  elif sudo -n true 2>/dev/null; then
    sudo install -d -m 0755 "$dest_dir"
    sudo install -m 0644 "$CA_FILE" "$dest"
    sudo update-ca-certificates
  else
    return 2
  fi
  ok "Dev root CA installed (Debian update-ca-certificates). Restart browsers if they still distrust."
  return 0
}

_run_rhel() {
  local dest_dir="/etc/pki/ca-trust/source/anchors"
  local dest="$dest_dir/dev-root-och.pem"
  if [[ "$(id -u)" -eq 0 ]]; then
    install -d -m 0755 "$dest_dir"
    install -m 0644 "$CA_FILE" "$dest"
    update-ca-trust extract
  elif sudo -n true 2>/dev/null; then
    sudo install -d -m 0755 "$dest_dir"
    sudo install -m 0644 "$CA_FILE" "$dest"
    sudo update-ca-trust extract
  else
    return 2
  fi
  ok "Dev root CA installed (update-ca-trust). Restart browsers if they still distrust."
  return 0
}

if [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi microsoft /proc/version 2>/dev/null; then
  info "WSL detected — same Debian/RHEL CA paths apply inside the distro."
fi

if command -v update-ca-certificates >/dev/null 2>&1; then
  if _run_debian "/usr/local/share/ca-certificates"; then
    exit 0
  fi
elif command -v update-ca-trust >/dev/null 2>&1 && [[ -d /etc/pki/ca-trust/source/anchors ]]; then
  if _run_rhel; then
    exit 0
  fi
else
  info "No update-ca-certificates or update-ca-trust found — use SSL_CERT_FILE=$CA_FILE or install CA manually."
  exit 0
fi

# _run_* returned 2 = need interactive sudo
info "Could not run CA install without a TTY sudo password. On this host, run once:"
if command -v update-ca-certificates >/dev/null 2>&1; then
  echo "  sudo install -m 0644 \"$CA_FILE\" /usr/local/share/ca-certificates/dev-root-och.crt && sudo update-ca-certificates"
elif command -v update-ca-trust >/dev/null 2>&1; then
  echo "  sudo install -m 0644 \"$CA_FILE\" /etc/pki/ca-trust/source/anchors/dev-root-och.pem && sudo update-ca-trust extract"
fi
exit 0
