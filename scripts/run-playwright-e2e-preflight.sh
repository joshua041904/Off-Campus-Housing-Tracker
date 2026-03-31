#!/usr/bin/env bash
# Wait for the public edge (/api/readyz) and run Playwright E2E (strict TLS, hostname only).
# Invokes scripts/webapp-playwright-strict-edge.sh → playwright test (webapp/e2e — multiple spec files).
# Optional: E2E_SCREENSHOTS=1 ./scripts/webapp-playwright-strict-edge.sh e2e/ui-screenshots.spec.ts → webapp/e2e/screenshots/*.png
# No kubectl port-forward; no http://127.0.0.1:4020 — legacy E2E_API_BASE values are ignored.
# PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC (default 30) acts as a cluster/edge idle-stability gate before tests run.
#
# Usage: ./scripts/run-playwright-e2e-preflight.sh
#   SKIP_PLAYWRIGHT_E2E=1  — exit 0 immediately
#   E2E_API_BASE           — must be https (default https://off-campus-housing.test)
#   NODE_EXTRA_CA_CERTS    — default REPO_ROOT/certs/dev-root.pem (for curl --cacert + Node TLS)
#   PLAYWRIGHT_VERTICAL_STRICT / PLAYWRIGHT_STRICT_HTTP3 — set by run-preflight-scale-and-all-suites.sh by default
#     (PREFLIGHT_PLAYWRIGHT_STRICT_HTTP3=1) for CI parity with webapp `test:e2e:strict-verticals-and-integrity`.
#   Kafka readiness (optional; set when E2E stack includes a broker):
#     PLAYWRIGHT_WAIT_KAFKA_CONTAINER — docker container name/id with State.Health (e.g. compose kafka-1)
#     PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT — kubectl deployment name; runs kubectl wait --for=condition=available
#   Post–load-k6 recovery (avoid Playwright against a degraded edge):
#     PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC — default 30; require this many consecutive-success seconds of polling
#       (any failed curl resets the accumulator). Set 0 to skip (legacy: first 200 only).
#     PLAYWRIGHT_EDGE_RECOVERY_POLL_SEC — sleep between probes (default 2).
#     PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL — optional second URL (full https URL) that must also return 2xx each poll.
#     PLAYWRIGHT_EDGE_RECOVERY_INCLUDE_LISTINGS_HEALTH — default 1 when unset: also probe ${E2E_API_BASE}/api/listings/healthz
#       during recovery (set 0 to disable unless PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL is set).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=lib/edge-test-url.sh
source "$SCRIPT_DIR/lib/edge-test-url.sh"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
info() { echo "ℹ️  $*"; }

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

if [[ -n "${PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL:-}" ]]; then
  :
elif [[ "${PLAYWRIGHT_EDGE_RECOVERY_INCLUDE_LISTINGS_HEALTH:-1}" == "1" ]]; then
  PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL="${E2E_API_BASE}/api/listings/healthz"
  export PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL
fi

# Chromium for CI/local
if [[ -d "$REPO_ROOT/webapp/node_modules/@playwright/test" ]]; then
  (cd "$REPO_ROOT/webapp" && pnpm exec playwright install chromium) 2>/dev/null || true
fi

READY_URL="${E2E_API_BASE}/api/readyz"
EXTRA_URL="${PLAYWRIGHT_EDGE_RECOVERY_EXTRA_URL:-}"
[[ -n "$EXTRA_URL" ]] && info "Playwright edge extra probe: $EXTRA_URL"

if [[ -n "${PLAYWRIGHT_WAIT_KAFKA_CONTAINER:-}" ]]; then
  say "Waiting for Kafka container health (${PLAYWRIGHT_WAIT_KAFKA_CONTAINER})..."
  kafka_ok=0
  for _k in $(seq 1 90); do
    st="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${PLAYWRIGHT_WAIT_KAFKA_CONTAINER}" 2>/dev/null || echo missing)"
    if [[ "$st" == "healthy" ]]; then
      ok "Kafka container healthy (${PLAYWRIGHT_WAIT_KAFKA_CONTAINER})"
      kafka_ok=1
      break
    fi
    sleep 2
  done
  if [[ "$kafka_ok" != "1" ]]; then
    warn "Kafka container did not become healthy (set PLAYWRIGHT_WAIT_KAFKA_CONTAINER only for compose/k8s-local with a healthcheck)"
    exit 1
  fi
fi

if [[ -n "${PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT:-}" ]]; then
  say "Waiting for Kafka deployment (${PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT})..."
  kubectl wait --for=condition=available "deployment/${PLAYWRIGHT_WAIT_KAFKA_DEPLOYMENT}" --timeout=120s
  ok "Kafka deployment available"
fi

_curl_ok() {
  local u="$1"
  curl -sf --cacert "$CA" --max-time 5 "$u" >/dev/null 2>&1
}

_all_probes_ok() {
  _curl_ok "$READY_URL" || return 1
  if [[ -n "$EXTRA_URL" ]]; then
    _curl_ok "$EXTRA_URL" || return 1
  fi
  return 0
}

say "Playwright E2E: waiting for edge $READY_URL (TLS verify with CA=$CA)"
EDGE_OK=0
for _i in $(seq 1 60); do
  if _all_probes_ok; then
    ok "Edge reachable ($READY_URL${EXTRA_URL:+ + extra probe})"
    EDGE_OK=1
    break
  fi
  sleep 2
done
if [[ "$EDGE_OK" != "1" ]]; then
  warn "Edge did not become ready at $READY_URL"
  echo "Verify: curl --cacert \"$CA\" \"$READY_URL\"  (expect HTTP 200)" >&2
  [[ -n "$EXTRA_URL" ]] && echo "Extra probe: curl --cacert \"$CA\" \"$EXTRA_URL\"" >&2
  exit 1
fi

STABLE_SEC="${PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC:-30}"
POLL_SEC="${PLAYWRIGHT_EDGE_RECOVERY_POLL_SEC:-2}"
if [[ "${STABLE_SEC:-0}" =~ ^[0-9]+$ ]] && [[ "$STABLE_SEC" -gt 0 ]]; then
  say "Playwright recovery barrier: need ${STABLE_SEC}s consecutive OK (poll ${POLL_SEC}s; any failure resets)${EXTRA_URL:+; extra URL probe}"
  accum=0
  barrier_deadline=$(( $(date +%s) + 900 ))
  while true; do
    now=$(date +%s)
    if [[ "$now" -ge "$barrier_deadline" ]]; then
      warn "Recovery barrier timed out after 900s (still not stable ${STABLE_SEC}s)"
      exit 1
    fi
    if _all_probes_ok; then
      accum=$((accum + POLL_SEC))
      if [[ "$accum" -ge "$STABLE_SEC" ]]; then
        ok "Recovery barrier satisfied (${STABLE_SEC}s stable)"
        break
      fi
    else
      accum=0
    fi
    sleep "$POLL_SEC"
  done
else
  info "PLAYWRIGHT_EDGE_RECOVERY_STABLE_SEC=0 — skipping sustained recovery barrier (first OK only)"
fi

# Same suite as `pnpm --filter webapp test:e2e` — all Playwright projects in webapp/playwright.config.ts (10 spec files, 22 runnable tests + 1 skipped screenshot test unless E2E_SCREENSHOTS=1).
say "Running: webapp-playwright-strict-edge.sh → playwright test (full edge suite)"
chmod +x "$SCRIPT_DIR/webapp-playwright-strict-edge.sh" 2>/dev/null || true
"$SCRIPT_DIR/webapp-playwright-strict-edge.sh"
ok "Playwright E2E finished"
