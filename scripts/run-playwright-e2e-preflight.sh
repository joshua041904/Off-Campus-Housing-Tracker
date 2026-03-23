#!/usr/bin/env bash
# Wait for the public edge (/api/readyz) and run Playwright E2E (strict TLS, hostname only).
# No kubectl port-forward; no http://127.0.0.1:4020 — legacy E2E_API_BASE values are ignored.
#
# Usage: ./scripts/run-playwright-e2e-preflight.sh
#   SKIP_PLAYWRIGHT_E2E=1  — exit 0 immediately
#   E2E_API_BASE           — must be https (default https://off-campus-housing.test)
#   NODE_EXTRA_CA_CERTS    — default REPO_ROOT/certs/dev-root.pem (for curl --cacert + Node TLS)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

[[ "${SKIP_PLAYWRIGHT_E2E:-0}" == "1" ]] && { warn "SKIP_PLAYWRIGHT_E2E=1"; exit 0; }

CA="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"

if [[ ! -s "$CA" ]]; then
  warn "Missing CA at $CA — sync certs/dev-root.pem (preflight) or set NODE_EXTRA_CA_CERTS"
  exit 1
fi

E2E_API_BASE="$(edge_normalize_e2e_api_base)" || exit 1
edge_require_host_resolves "$E2E_API_BASE" || exit 1

unset API_GATEWAY_INTERNAL

export NODE_EXTRA_CA_CERTS="$CA"
export E2E_API_BASE

# Chromium for CI/local
if [[ -d "$REPO_ROOT/webapp/node_modules/@playwright/test" ]]; then
  (cd "$REPO_ROOT/webapp" && pnpm exec playwright install chromium) 2>/dev/null || true
fi

say "Playwright E2E: waiting for edge ${E2E_API_BASE}/api/readyz (TLS verify with CA=$CA)"
EDGE_OK=0
for i in $(seq 1 60); do
  if curl -sf --cacert "$CA" --max-time 5 "${E2E_API_BASE}/api/readyz" >/dev/null 2>&1; then
    ok "Edge ready (${E2E_API_BASE}/api/readyz)"
    EDGE_OK=1
    break
  fi
  sleep 2
done
if [[ "$EDGE_OK" != "1" ]]; then
  warn "Edge did not become ready at ${E2E_API_BASE}/api/readyz"
  echo "Verify: curl --cacert \"$CA\" \"${E2E_API_BASE}/api/readyz\"  (expect HTTP 200)" >&2
  exit 1
fi

say "Running: pnpm --filter webapp test:e2e"
pnpm --filter webapp test:e2e
ok "Playwright E2E finished"
