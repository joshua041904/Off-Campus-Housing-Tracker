#!/usr/bin/env bash
set -euo pipefail

# Build custom k6 with HTTP/3 (QUIC) via xk6 + bandorko/xk6-http3 (import: k6/x/http3).
#
# Pin BOTH k6 core and the extension — do not use @latest for k6 core (breaks module graph).
#
# Defaults (override with env):
#   HTTP3_EXTENSION   github.com/bandorko/xk6-http3@v0.2.0
#                     Note: upstream repo has tags v0.2.0 / v0.1.1 only — there is NO v0.3.0 on GitHub.
#                     If you have a fork with v0.3.0: HTTP3_EXTENSION=github.com/you/xk6-http3@v0.3.0
#   K6_XK6_VERSION    If set, only that k6 tag is built (no auto-fallback).
#                     If unset: try v0.49.0, then v0.48.0 (recommended when extension lags k6).
#   XK6_TOOL_VERSION  xk6 CLI to install when missing (default v1.3.6).
#   XK6_PURGE_GO_CACHE=1  Before build: go clean -modcache + remove common Go caches (use when resolving fails).

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

if ! command -v go >/dev/null 2>&1; then
  fail "Go is required. Install from https://golang.org/dl/"
fi

XK6_TOOL_VERSION="${XK6_TOOL_VERSION:-v1.3.6}"
if ! command -v xk6 >/dev/null 2>&1; then
  if [[ -f "$HOME/go/bin/xk6" ]]; then
    export PATH="$HOME/go/bin:$PATH"
  else
    warn "xk6 not found. Installing pinned xk6 CLI: $XK6_TOOL_VERSION"
    go install "go.k6.io/xk6/cmd/xk6@${XK6_TOOL_VERSION}"
    export PATH="$HOME/go/bin:$PATH"
  fi
fi

ok "xk6 found: $(command -v xk6)"

HTTP3_EXT="${HTTP3_EXTENSION:-github.com/bandorko/xk6-http3@v0.2.0}"

if [[ "${XK6_PURGE_GO_CACHE:-0}" == "1" ]]; then
  say "XK6_PURGE_GO_CACHE=1 — clearing module and build caches (slow next fetch)..."
  go clean -modcache 2>/dev/null || true
  rm -rf "${HOME}/go/pkg/mod" 2>/dev/null || true
  rm -rf "${HOME}/Library/Caches/go-build" 2>/dev/null || true
  rm -rf "${HOME}/.cache/go-build" 2>/dev/null || true
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/.k6-build"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
: > build.log

try_build() {
  local tag="$1"
  say "xk6 build k6 $tag --with $HTTP3_EXT (appending build.log)..."
  if xk6 build --with "$HTTP3_EXT" --output k6-http3 "$tag" >>build.log 2>&1; then
    return 0
  fi
  return 1
}

say "=== Building k6 with HTTP/3 (xk6-http3) ==="
say "Extension: $HTTP3_EXT"

if [[ -n "${K6_XK6_VERSION:-}" ]]; then
  try_build "$K6_XK6_VERSION" || fail "xk6 build failed for K6_XK6_VERSION=$K6_XK6_VERSION — see $BUILD_DIR/build.log"
else
  if try_build "v0.49.0"; then
    ok "Built with k6 v0.49.0"
  else
    warn "k6 v0.49.0 + extension failed (see build.log). Retrying k6 v0.48.0..."
    try_build "v0.48.0" || fail "xk6 build failed for v0.49.0 and v0.48.0 — try XK6_PURGE_GO_CACHE=1 or set K6_XK6_VERSION / HTTP3_EXTENSION. Log: $BUILD_DIR/build.log"
    ok "Built with k6 v0.48.0"
  fi
fi

if [[ -f "k6-http3" ]]; then
  ok "k6 binary: $BUILD_DIR/k6-http3"
  say "Testing custom k6 binary..."
  ./k6-http3 version
  INSTALL_DIR="$(pwd)/bin"
  mkdir -p "$INSTALL_DIR"
  cp k6-http3 "$INSTALL_DIR/k6-http3"
  chmod +x "$INSTALL_DIR/k6-http3"
  ok "Also: $INSTALL_DIR/k6-http3"
  say ""
  say "Verify HTTP/3 module loads (needs reachable edge + dev CA):"
  say "  $INSTALL_DIR/k6-http3 run -e BASE_URL=https://off-campus-housing.test scripts/load/k6-http3-complete.js"
else
  fail "k6 binary not found after build. Check build.log for errors."
fi
