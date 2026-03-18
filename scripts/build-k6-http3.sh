#!/usr/bin/env bash
set -euo pipefail

# Script to build custom k6 binary with HTTP/3 support using xk6
# This creates our own k6 toolchain with HTTP/3 (QUIC) support

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Check prerequisites
if ! command -v go >/dev/null 2>&1; then
  fail "Go is required. Install from https://golang.org/dl/"
fi

if ! command -v xk6 >/dev/null 2>&1; then
  if [[ -f "$HOME/go/bin/xk6" ]]; then
    export PATH="$HOME/go/bin:$PATH"
  else
    warn "xk6 not found. Installing..."
    go install go.k6.io/xk6/cmd/xk6@latest
    export PATH="$HOME/go/bin:$PATH"
  fi
fi

ok "xk6 found: $(which xk6)"

# Check for HTTP/3 extension
# Note: There isn't an official xk6-http3 extension yet, but we can try to build with experimental support
# or use a community extension if available

say "=== Building Custom k6 Binary with HTTP/3 Support ==="

# Use our custom HTTP/3 extension
HTTP3_EXT=""
if [[ -n "${HTTP3_EXTENSION:-}" ]]; then
  HTTP3_EXT="$HTTP3_EXTENSION"
  ok "Using custom HTTP/3 extension: $HTTP3_EXT"
elif [[ -d "$(pwd)/xk6-http3" ]]; then
  # Use local extension
  HTTP3_EXT="$(pwd)/xk6-http3"
  ok "Using local HTTP/3 extension: $HTTP3_EXT"
else
  warn "No HTTP/3 extension found. Creating one..."
  "$(pwd)/scripts/create-k6-http3-extension.sh" || warn "Extension creation failed, building without HTTP/3 extension"
  if [[ -d "$(pwd)/xk6-http3" ]]; then
    HTTP3_EXT="$(pwd)/xk6-http3"
    ok "Using newly created HTTP/3 extension: $HTTP3_EXT"
  fi
fi

# Build directory
BUILD_DIR="$(pwd)/.k6-build"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Build k6 with HTTP/3 support
say "Building custom k6 binary..."

if [[ -n "$HTTP3_EXT" ]]; then
  # Build with extension
  if [[ -d "$HTTP3_EXT" ]]; then
    # For local extensions, we need to use the module path from go.mod
    say "Building with local extension from: $HTTP3_EXT"
    MODULE_PATH=$(cd "$HTTP3_EXT" && grep "^module " go.mod | awk '{print $2}')
    if [[ -z "$MODULE_PATH" ]]; then
      fail "Could not determine module path from $HTTP3_EXT/go.mod"
    fi
    say "Using module path: $MODULE_PATH"
    
    # Use xk6 build with local extension
    # xk6 doesn't support local paths directly, so we'll build manually with replace directive
    say "Building k6 with local HTTP/3 extension..."
    
    # Create build directory
    XK6_BUILD="$BUILD_DIR/xk6-work"
    mkdir -p "$XK6_BUILD"
    cd "$XK6_BUILD"
    
    # Initialize go module
    go mod init k6-custom-http3
    
    # Add k6 dependency
    go get go.k6.io/k6@v0.50.0
    
    # Add replace directive FIRST (before adding the module)
    go mod edit -replace "$MODULE_PATH=$HTTP3_EXT"
    
    # Now add the module (with replace in place, it will use local path)
    go get "$MODULE_PATH@v0.0.0"
    go mod tidy
    
    # Create main.go that imports k6 and registers our extension
    cat > main.go <<'MAINGO'
package main

import (
	_ "github.com/off-campus-housing-tracker/xk6-http3"
	"go.k6.io/k6/cmd"
)

func main() {
	cmd.Execute()
}
MAINGO
    
    # Make sure the extension is actually required
    go get github.com/off-campus-housing-tracker/xk6-http3@v0.0.0
    go get go.k6.io/k6/cmd@v0.50.0
    go mod tidy
    
    # Build
    go build -o "$BUILD_DIR/k6-http3" . 2>&1 | tee "$BUILD_DIR/build.log" || {
      cd "$BUILD_DIR"
      rm -rf "$XK6_BUILD"
      warn "Failed to build with local extension. Check build.log for details."
      fail "Build failed. Make sure the extension compiles: cd $HTTP3_EXT && go mod tidy && go build ./..."
    }
    
    cd "$BUILD_DIR"
    rm -rf "$XK6_BUILD"
  else
    # Assume it's a module path
    xk6 build \
      --with "$HTTP3_EXT" \
      --output k6-http3 \
      v0.50.0 2>&1 | tee build.log || {
      warn "Failed to build with extension. Trying without extension..."
      xk6 build \
        --output k6-http3 \
        v0.50.0 2>&1 | tee build.log
    }
  fi
else
  # Build standard k6 (won't have HTTP/3 support)
  warn "Building k6 without HTTP/3 extension - HTTP/3 will not work!"
  xk6 build \
    --output k6-http3 \
    v0.50.0 2>&1 | tee build.log || {
    fail "Failed to build k6 binary. Check build.log for details."
  }
fi

if [[ -f "k6-http3" ]]; then
  ok "k6 binary built successfully: $BUILD_DIR/k6-http3"
  
  # Test the binary
  say "Testing custom k6 binary..."
  ./k6-http3 version
  
  # Install to a convenient location
  INSTALL_DIR="$(pwd)/bin"
  mkdir -p "$INSTALL_DIR"
  cp k6-http3 "$INSTALL_DIR/k6-http3"
  chmod +x "$INSTALL_DIR/k6-http3"
  
  ok "Custom k6 binary installed to: $INSTALL_DIR/k6-http3"
  say ""
  say "Usage:"
  say "  $INSTALL_DIR/k6-http3 run scripts/load/k6-http3-toolchain.js"
  say ""
  say "Or add to PATH:"
  say "  export PATH=\"$INSTALL_DIR:\$PATH\""
  say "  k6-http3 run scripts/load/k6-http3-toolchain.js"
else
  fail "k6 binary not found after build. Check build.log for errors."
fi

