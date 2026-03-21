#!/usr/bin/env bash
# Port-forward api-gateway to localhost:4020 and run Playwright E2E (webapp against real stack).
# Exits 1 if the gateway never answers /api/healthz (so flows/auth-cycle specs are not silently skipped).
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/run-playwright-e2e-preflight.sh
#   SKIP_PLAYWRIGHT_E2E=1  — exit 0 immediately
#   PLAYWRIGHT_PORT=4020   — local port for gateway
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
LOCAL_PORT="${PLAYWRIGHT_PORT:-4020}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

[[ "${SKIP_PLAYWRIGHT_E2E:-0}" == "1" ]] && { warn "SKIP_PLAYWRIGHT_E2E=1"; exit 0; }

if ! command -v kubectl >/dev/null 2>&1; then
  warn "kubectl not found — skip Playwright preflight"
  exit 0
fi

if ! kubectl get deploy api-gateway -n "$HOUSING_NS" &>/dev/null; then
  warn "api-gateway not in $HOUSING_NS — skip Playwright preflight"
  exit 0
fi

if ! kubectl get pods -n "$HOUSING_NS" -l app=api-gateway --field-selector=status.phase=Running 2>/dev/null | grep -q Running; then
  warn "api-gateway pod not Running — skip Playwright preflight"
  exit 0
fi

# Chromium for CI/local
if [[ -d "$REPO_ROOT/webapp/node_modules/@playwright/test" ]]; then
  ( cd "$REPO_ROOT/webapp" && pnpm exec playwright install chromium ) 2>/dev/null || true
fi

say "Playwright E2E: port-forward api-gateway → 127.0.0.1:$LOCAL_PORT"
kubectl -n "$HOUSING_NS" port-forward "svc/api-gateway" "$LOCAL_PORT:4020" &
PF_PID=$!
cleanup() {
  kill "$PF_PID" 2>/dev/null || true
}
trap cleanup EXIT

GATEWAY_OK=0
for i in $(seq 1 45); do
  if curl -sf --max-time 2 "http://127.0.0.1:$LOCAL_PORT/api/healthz" >/dev/null 2>&1; then
    ok "Gateway reachable on 127.0.0.1:$LOCAL_PORT"
    GATEWAY_OK=1
    break
  fi
  sleep 1
done
if [[ "$GATEWAY_OK" != "1" ]]; then
  warn "Gateway did not become ready on 127.0.0.1:$LOCAL_PORT after port-forward — fix cluster or run without this script for guest-only E2E"
  exit 1
fi

export E2E_API_BASE="http://127.0.0.1:$LOCAL_PORT"
export API_GATEWAY_INTERNAL="http://127.0.0.1:$LOCAL_PORT"
export CI="${CI:-}"

say "Running: pnpm --filter webapp test:e2e"
pnpm --filter webapp test:e2e
ok "Playwright E2E finished"
