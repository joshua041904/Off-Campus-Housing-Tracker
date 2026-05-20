#!/usr/bin/env bash
# Enforce curl version + HTTP/3 for bootstrap, make deps, and strict preflight flows.
# Prefer Homebrew curl on macOS: brew install curl && export PATH="/opt/homebrew/opt/curl/bin:$PATH"
#
# Env:
#   CURL_BIN              — explicit curl executable (overrides PATH)
#   MIN_CURL_VERSION      — default 8.19.0
#   SKIP_CURL_MIN_VERSION=1 — skip semver gate only (HTTP/3 checks still run)
#   SKIP_CURL_HTTP3_CHECK=1  — skip HTTP/3 feature + --http3 checks (not recommended)
set -euo pipefail

MIN_CURL_VERSION="${MIN_CURL_VERSION:-8.19.0}"

bad() { echo "❌ $*" >&2; }

_resolve_curl() {
  if [[ -n "${CURL_BIN:-}" ]]; then
    if [[ -x "${CURL_BIN}" ]]; then
      printf '%s' "${CURL_BIN}"
      return 0
    fi
    bad "CURL_BIN is set but not executable: ${CURL_BIN}"
    return 1
  fi
  if command -v curl >/dev/null 2>&1; then
    command -v curl
    return 0
  fi
  bad "curl not on PATH. Install: brew install curl && export PATH=\"/opt/homebrew/opt/curl/bin:\$PATH\""
  return 1
}

_has_help_http3() {
  local bin="$1"
  [[ -x "$bin" ]] || return 1
  "$bin" --help all 2>/dev/null | grep -q -- '--http3'
}

_cb="$(_resolve_curl)" || exit 1

_ver_line="$("$_cb" -V 2>&1 | head -1)"
# First line: curl 8.19.0 (aarch64-apple-darwin...) ...
if [[ ! "${_ver_line}" =~ ^curl[[:space:]]+([0-9]+\.[0-9]+\.[0-9]+) ]]; then
  bad "Could not parse curl version from: ${_ver_line}"
  exit 1
fi
_have="${BASH_REMATCH[1]}"

if [[ "${SKIP_CURL_MIN_VERSION:-0}" != "1" ]]; then
  if ! command -v sort >/dev/null 2>&1; then
    bad "sort not on PATH (needed for version compare)"
    exit 1
  fi
  _lowest="$(printf '%s\n' "${_have}" "${MIN_CURL_VERSION}" | sort -V | head -n1)"
  if [[ "${_lowest}" != "${MIN_CURL_VERSION}" ]]; then
    bad "curl ${_have} < required ${MIN_CURL_VERSION} (${_cb}). brew install curl + put it first on PATH."
    exit 1
  fi
fi

if [[ "${SKIP_CURL_HTTP3_CHECK:-0}" != "1" ]]; then
  _feat="$("$_cb" -V 2>&1 | tr -d '\r' | grep -i '^Features:' || true)"
  if [[ -z "${_feat}" ]] || ! grep -qiE '\bHTTP3\b' <<<"${_feat}"; then
    bad "curl at ${_cb} does not report HTTP3 on the Features line. Diagnose: ./scripts/verify-curl-http3.sh"
    exit 1
  fi
  if ! _has_help_http3 "${_cb}"; then
    bad "curl at ${_cb} has no --http3 in curl --help all (too old / wrong build)."
    exit 1
  fi
fi

echo "✅ curl preflight OK: ${_cb} (version ${_have})"
exit 0
