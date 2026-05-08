#!/usr/bin/env bash
# Drive real browser traffic against analytics E2E specs (edge TLS). Produces Jaeger + gateway route hits.
# Prereq: stack up, certs trusted, webapp Playwright installed (`pnpm install` at repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$ROOT/certs/dev-root.pem}"
export E2E_API_BASE="${E2E_API_BASE:-https://off-campus-housing.test}"
exec pnpm --filter webapp exec playwright test --project=04-analytics
