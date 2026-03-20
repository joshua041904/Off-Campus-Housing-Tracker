#!/usr/bin/env bash
# Diagnose which curl binaries are on the host and whether they can speak HTTP/3.
# See Runbook.md item 91 (macOS SecureTransport vs Homebrew vs Docker http3_curl).

set -euo pipefail

echo "=== http3_curl ==="
echo "http3_curl is a bash function in scripts/lib/http3.sh, not a standalone binary."
echo "  which http3_curl → (usually empty until you: source scripts/lib/http3.sh)"
echo ""

echo "=== curl on PATH ==="
command -v curl || echo "(no curl in PATH)"
type -a curl 2>/dev/null || true
echo ""

echo "=== curl -V (first on PATH) ==="
if command -v curl >/dev/null 2>&1; then
  curl -V 2>&1 || true
else
  echo "(skipped — no curl)"
fi
echo ""

_has_http3_flag() {
  local bin="$1"
  [[ -x "$bin" ]] || return 1
  "$bin" --help all 2>/dev/null | grep -q -- '--http3'
}

echo "=== --http3 in curl --help all? (first on PATH) ==="
if command -v curl >/dev/null 2>&1; then
  if _has_http3_flag "$(command -v curl)"; then
    echo "YES — $(command -v curl) advertises --http3"
  else
    echo "NO — $(command -v curl) does not advertise --http3 (common for Apple /usr/bin/curl)"
  fi
else
  echo "(no curl)"
fi
echo ""

echo "=== CURL_BIN (if set) ==="
if [[ -n "${CURL_BIN:-}" ]]; then
  echo "CURL_BIN=${CURL_BIN}"
  if [[ -x "${CURL_BIN}" ]]; then
    "${CURL_BIN}" -V 2>&1 || true
    if _has_http3_flag "${CURL_BIN}"; then
      echo "CURL_BIN: YES --http3"
    else
      echo "CURL_BIN: NO --http3"
    fi
  else
    echo "(CURL_BIN is not executable)"
  fi
else
  echo "(unset — http3_curl will use PATH curl or Docker HTTP3_IMAGE)"
fi
echo ""

echo "=== Homebrew curl (common install locations) ==="
for p in /opt/homebrew/opt/curl/bin/curl /usr/local/opt/curl/bin/curl; do
  if [[ -x "$p" ]]; then
    echo "--- $p ---"
    "$p" -V 2>&1 || true
    if _has_http3_flag "$p"; then
      echo "$p: YES --http3"
    else
      echo "$p: NO --http3"
    fi
    echo ""
  fi
done

echo "=== Features to look for (Homebrew / QUIC-capable build) ==="
echo "  curl -V → line 'Features:' should include HTTP3"
echo "  curl -V → 'libcurl' line often lists OpenSSL, ngtcp2, nghttp3 (not SecureTransport-only)"
echo ""
echo "To prefer Homebrew curl on Apple Silicon:"
echo "  export PATH=\"/opt/homebrew/opt/curl/bin:\$PATH\""
echo "Intel Homebrew:"
echo "  export PATH=\"/usr/local/opt/curl/bin:\$PATH\""
echo ""
echo "After sourcing http3.sh, call http3_curl -V to see the same binary the function would use on the native path."
