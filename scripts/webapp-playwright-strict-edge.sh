#!/usr/bin/env bash
# Run Playwright with Node trusting dev-root (NODE_EXTRA_CA_CERTS). Pages + API use E2E_API_BASE (https edge).
#
# Usage (from repo root):
#   ./scripts/webapp-playwright-strict-edge.sh
# Env:
#   E2E_API_BASE   — https only (default https://off-campus-housing.test); :4020 / http localhost rejected
#   NODE_EXTRA_CA_CERTS — default REPO_ROOT/certs/dev-root.pem
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/edge-test-url.sh
source "$ROOT/scripts/lib/edge-test-url.sh"

CA="${NODE_EXTRA_CA_CERTS:-$ROOT/certs/dev-root.pem}"
if [[ ! -s "$CA" ]]; then
  echo "Missing CA at $CA — sync certs/dev-root.pem (preflight / reissue) first."
  exit 1
fi

E2E_API_BASE="$(edge_normalize_e2e_api_base)" || exit 1
edge_require_host_resolves "$E2E_API_BASE" || exit 1

unset API_GATEWAY_INTERNAL

export NODE_EXTRA_CA_CERTS="$CA"
export E2E_API_BASE

cd "$ROOT/webapp"
exec pnpm exec playwright test "$@"
