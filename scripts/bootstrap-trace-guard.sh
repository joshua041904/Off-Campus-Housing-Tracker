#!/usr/bin/env bash
# Pre–trace-contract gate:
#   1) api-gateway image digest vs local
#   2) GET /api/debug/full-trace returns 2xx
#   3) JSON fan-out: ok=true and every downstream hop succeeded (catches stale *-service images after @common/utils changes)
#
# Self-heal when BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD=1 (default):
#   - (1)(2) failure → make rebuild-api-gateway once
#   - (3) failure → make rebuild-housing-rollout once (all default housing :dev images + rollouts), unless
#     BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD_HOUSING=0
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NS="${HOUSING_NS:-off-campus-housing-tracker}"
BASE="${E2E_API_BASE:-https://off-campus-housing.test}"
URL="${BASE%/}/api/debug/full-trace"
AUTO="${BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD:-1}"
# Rebuild all housing app images when full-trace JSON reports failed hops (404 / timeouts on /debug/headers, etc.)
AUTO_HOUSING="${BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD_HOUSING:-1}"
_FANOUT_TIMEOUT="${TRACE_GUARD_FANOUT_TIMEOUT_SEC:-20}"

chmod +x "$ROOT/scripts/verify-image-digest.sh" "$ROOT/scripts/verify-route-exists.sh"

make_rebuild_gateway() {
  echo "bootstrap-trace-guard: invoking rebuild-api-gateway (one-shot self-heal)"
  command make -C "$ROOT" rebuild-api-gateway
}

make_rebuild_housing_all() {
  echo "bootstrap-trace-guard: invoking rebuild-housing-rollout (all default housing :dev images + rollouts)"
  command make -C "$ROOT" rebuild-housing-rollout
}

_run_image() {
  bash "$ROOT/scripts/verify-image-digest.sh" api-gateway "$NS" api-gateway
}

_run_route() {
  bash "$ROOT/scripts/verify-route-exists.sh" "$URL"
}

# Requires full-trace multi-hop success (not only HTTP 200 with ok:false).
_run_fanout_ok() {
  echo "▶ bootstrap-trace-guard: full-trace fan-out (expect ok=true, all hops 2xx)"
  local body
  body="$(curl -ksS --max-time "$_FANOUT_TIMEOUT" -H "x-traffic-class: infra" "$URL" || true)"
  if ! printf '%s' "$body" | node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
let j;
try {
  j = JSON.parse(raw);
} catch (e) {
  console.error("::error::full-trace: invalid JSON body");
  process.exit(1);
}
if (j.trace !== "full" || typeof j.total !== "number") {
  console.error("::error::full-trace: unexpected shape (missing trace/total)");
  process.exit(1);
}
if (j.ok !== true || j.success !== j.total) {
  console.error("::error::full-trace: ok=false or incomplete success (failed downstreams / stale images)", {
    ok: j.ok,
    success: j.success,
    total: j.total,
    failed: j.failed,
    steps: j.steps,
  });
  if (Array.isArray(j.services)) {
    for (const row of j.services) {
      if (row && row.ok === false) {
        console.error("  hop:", row.key, row.service, row.status, row.error || "");
      }
    }
  }
  process.exit(1);
}
process.exit(0);
'; then
    return 1
  fi
  echo "✅ bootstrap-trace-guard: full-trace fan-out OK ($URL)"
  return 0
}

_rebuilt_gateway=0
_housing_rebuilt=0

if ! _run_image; then
  echo "::warning::bootstrap-trace-guard: api-gateway image digest check failed"
  if [[ "$AUTO" != "1" ]]; then
    echo "  Set BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD=1 or run: make rebuild-api-gateway"
    exit 1
  fi
  make_rebuild_gateway
  _rebuilt_gateway=1
  _run_image
fi

if ! _run_route; then
  echo "::warning::bootstrap-trace-guard: full-trace route check failed (often stale :dev image in cluster)"
  if [[ "$AUTO" != "1" ]]; then
    echo "  Set BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD=1 or run: make rebuild-api-gateway"
    exit 1
  fi
  if [[ "$_rebuilt_gateway" != "1" ]]; then
    make_rebuild_gateway
    _rebuilt_gateway=1
  fi
  _run_route
fi

if ! _run_fanout_ok; then
  echo "::warning::bootstrap-trace-guard: full-trace fan-out failed (downstream *-service images often stale vs repo)"
  if [[ "$AUTO" != "1" ]] || [[ "$AUTO_HOUSING" != "1" ]]; then
    echo "  Fix: BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD=1 and BOOTSTRAP_TRACE_GUARD_AUTO_REBUILD_HOUSING=1 (defaults), or run: make rebuild-housing-rollout"
    exit 1
  fi
  if [[ "$_housing_rebuilt" != "1" ]]; then
    make_rebuild_housing_all
    _housing_rebuilt=1
  fi
  if ! _run_fanout_ok; then
    echo "::error::bootstrap-trace-guard: full-trace fan-out still failing after rebuild-housing-rollout"
    echo "  Try: COLD_BOOTSTRAP_REBUILD_APP_IMAGES=1 make cold-bootstrap   or   BOOTSTRAP_FORCE_REBUILD_IMAGES=1 make bootstrap"
    exit 1
  fi
fi

echo "✅ bootstrap-trace-guard OK (image + route + full-trace fan-out)"
