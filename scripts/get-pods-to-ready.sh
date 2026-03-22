#!/usr/bin/env bash
# Get all off-campus-housing-tracker app pods to 1/1 Ready.
# Fixes: 0/1 (host.docker.internal wrong on Colima), shopping order_number duplicate, and verifies DB connectivity.
#
# Usage:
#   ./scripts/get-pods-to-ready.sh
#   ./scripts/get-pods-to-ready.sh --diagnose   # also run diagnose-502-and-analytics.sh
#
# After running: wait for rollout (e.g. kubectl -n off-campus-housing-tracker rollout status deploy -l app -t 120s)
# or: ./scripts/ensure-readiness-before-suites.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "ℹ️  $*"; }

RUN_DIAGNOSE="${1:-}"
ctx=$(kubectl config current-context 2>/dev/null || echo "")

say "=== Get off-campus-housing-tracker pods to 1/1 Ready ==="

# 1. Colima: patch host.docker.internal so pods can reach Postgres/Redis on host
if [[ "$ctx" == *"colima"* ]] && [[ -x "$SCRIPT_DIR/colima-apply-host-aliases.sh" ]]; then
  say "1. Colima: applying host aliases (host.docker.internal → Mac host)..."
  if "$SCRIPT_DIR/colima-apply-host-aliases.sh" 2>&1; then
    ok "Host aliases applied; deployments will roll out with correct IP"
  else
    warn "Host aliases script failed; pods may stay 0/1 if gateway IP is wrong"
  fi
else
  info "1. Not Colima or script missing; skipping host aliases (k3d uses 192.168.5.2 from base)"
fi

# 2. Housing stack: ports 5441–5448. Skip shopping-specific steps; use verify-db-cache-quick.sh for DB checks.
say "2. Housing DBs (5441–5448): skipping shopping-specific steps; run scripts/verify-db-cache-quick.sh for connectivity."

# 3. Wait for rollouts (patch in step 1 triggers new pods)
say "3. Waiting for deployments to roll out (up to 120s per deploy)..."
for d in api-gateway auth-service listings-service booking-service messaging-service trust-service analytics-service; do
  if kubectl get deployment "$d" -n off-campus-housing-tracker --request-timeout=5s >/dev/null 2>&1; then
    if kubectl -n off-campus-housing-tracker rollout status "deploy/$d" --timeout=120s 2>/dev/null; then
      ok "$d: 1/1"
    else
      warn "$d: rollout not complete (check: kubectl -n off-campus-housing-tracker get pods -l app=$d)"
    fi
  fi
done

# 4. Optional: live DB diagnostic
if [[ "$RUN_DIAGNOSE" == "--diagnose" ]] && [[ -x "$SCRIPT_DIR/diagnose-502-and-analytics.sh" ]]; then
  say "4. Running live 502/analytics diagnostic..."
  "$SCRIPT_DIR/diagnose-502-and-analytics.sh" 2>&1 || true
else
  info "4. Run ./scripts/diagnose-502-and-analytics.sh to verify pod→DB connectivity"
fi

say "Done"
kubectl -n off-campus-housing-tracker get pods 2>/dev/null | head -30
