#!/usr/bin/env bash
# Run Playwright against https://off-campus-housing.test with strict TLS (no ignoreHTTPSErrors).
# Node trusts the dev CA via NODE_EXTRA_CA_CERTS (rotation-safe when preflight syncs certs/dev-root.pem).
#
# Usage (from repo root):
#   ./scripts/webapp-playwright-strict-edge.sh
# Env:
#   E2E_BASE_URL   default https://off-campus-housing.test
#   WEBAPP_E2E_PORT — unused in edge mode (Next still needed if tests hit local dev server only)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CA="${NODE_EXTRA_CA_CERTS:-$ROOT/certs/dev-root.pem}"
if [[ ! -s "$CA" ]]; then
  echo "Missing CA at $CA — sync certs/dev-root.pem (preflight / reissue) first."
  exit 1
fi
export NODE_EXTRA_CA_CERTS="$CA"
export E2E_EDGE_TLS="${E2E_EDGE_TLS:-1}"
export E2E_BASE_URL="${E2E_BASE_URL:-https://off-campus-housing.test}"
export E2E_API_BASE="${E2E_API_BASE:-$E2E_BASE_URL}"
cd "$ROOT/webapp"
exec pnpm exec playwright test "$@"
