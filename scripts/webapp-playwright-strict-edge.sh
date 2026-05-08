#!/usr/bin/env bash
# Run Playwright with Node trusting dev-root (NODE_EXTRA_CA_CERTS). Pages + API use E2E_API_BASE (https edge).
#
# Usage (from repo root):
#   ./scripts/webapp-playwright-strict-edge.sh
#   ./scripts/webapp-playwright-strict-edge.sh e2e/foo.spec.ts   # custom args → forwarded to playwright test
# Env:
#   E2E_API_BASE   — https only (default https://off-campus-housing.test); :4020 / http localhost rejected
#   NODE_EXTRA_CA_CERTS — default REPO_ROOT/certs/dev-root.pem
#   PLAYWRIGHT_E2E_MATRIX=full — run all Playwright projects (01–07). Default: strict verticals + system integrity (06+07),
#     matching pnpm run test:e2e:strict-verticals-and-integrity (cross-service / transport coverage).
#   OTEL (Playwright Node process — optional future instrumentation; must not force localhost OTLP):
#     OTEL_SERVICE_NAME (default playwright-e2e-runner)
#     OTEL_EXPORTER_OTLP_ENDPOINT / OCH_JAEGER_OTLP_HOST — set to MetalLB or in-cluster-reachable collector (not 127.0.0.1
#     unless OCH_OTEL_LOCAL_JAEGER=1).
#   JAEGER_QUERY_BASE — optional if discoverable (edge /jaeger, JAEGER_PUBLIC_URL MetalLB, etc.). Probed via /api/services before tests.
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
export REPO_ROOT="$ROOT"
# shellcheck source=/dev/null
[[ -f "$ROOT/scripts/lib/jaeger-resolve-query-base.sh" ]] && source "$ROOT/scripts/lib/jaeger-resolve-query-base.sh"
if command -v och_jaeger_resolve_query_base >/dev/null 2>&1; then
  och_jaeger_resolve_query_base || true
fi
# Reduce parallel edge load during strict verticals (preflight + CI); override with PLAYWRIGHT_WORKERS=4 etc.
export PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-2}"

if [[ -z "${JAEGER_QUERY_BASE:-}" ]]; then
  echo "JAEGER_QUERY_BASE unset — set JAEGER_PUBLIC_URL, JAEGER_QUERY_BASE, or use edge https://off-campus-housing.test/jaeger (scripts/lib/jaeger-resolve-query-base.sh)" >&2
  exit 1
fi
export TRACE_LOOKBACK_SECONDS=180
export JAEGER_VERIFY_TRACE_STRUCTURE=1

# OTEL for the Playwright runner Node process (align with backend invariants; never default to loopback).
export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-playwright-e2e-runner}"
if [[ -n "${OCH_JAEGER_OTLP_HOST:-}" && -z "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" && -z "${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:-}" ]]; then
  if [[ "${OCH_JAEGER_OTLP_HOST}" =~ ^https?:// ]]; then
    export OTEL_EXPORTER_OTLP_ENDPOINT="${OCH_JAEGER_OTLP_HOST}"
  else
    export OTEL_EXPORTER_OTLP_ENDPOINT="http://${OCH_JAEGER_OTLP_HOST}:4318"
  fi
fi

_jq="${JAEGER_QUERY_BASE%/}"
if [[ "${_jq}" == https:* ]]; then
  if ! curl -sfS --max-time 15 --cacert "$CA" "${_jq}/api/services" >/dev/null; then
    echo "Jaeger query API not reachable at JAEGER_QUERY_BASE=${JAEGER_QUERY_BASE}" >&2
    exit 1
  fi
else
  if ! curl -sfS --max-time 15 "${_jq}/api/services" >/dev/null; then
    echo "Jaeger query API not reachable at JAEGER_QUERY_BASE=${JAEGER_QUERY_BASE}" >&2
    exit 1
  fi
fi

cd "$ROOT/webapp"

if [[ $# -gt 0 ]]; then
  exec pnpm exec playwright test "$@"
fi

if [[ "${PLAYWRIGHT_E2E_MATRIX:-}" == "full" ]]; then
  exec pnpm exec playwright test
fi

exec pnpm run test:e2e:strict-verticals-and-integrity
