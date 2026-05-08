#!/usr/bin/env bash
# Strict-suite HTTP verticals: gateway ↔ service same-trace contract (data-driven flows).
# Flow names must exist in infra/observability/trace-flows.json (booking-http, listings-http, auth-http).
#
# Global coverage (every initTracing service listed in Jaeger): verify-jaeger-tracing-services.sh
# Async / Kafka flows: verify-jaeger-async-verticals.sh
#
# Optional: TRACE_VALIDATION_REPORT_DIR — append JSON/MD/alerts/Prom rows via verify-jaeger-trace-flows.mjs --report-dir
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${JAEGER_QUERY_BASE:?Set JAEGER_QUERY_BASE (Jaeger query UI origin, e.g. http://host:16686)}"
BASE="${BASE%/}"

if [[ -x "$SCRIPT_DIR/preflight/kubectl-set-otel-always-on-step7.sh" ]]; then
  "$SCRIPT_DIR/preflight/kubectl-set-otel-always-on-step7.sh" || true
fi

FLOWS=(
  booking-http
  listings-http
  auth-http
)

extra=(--lookback "${JAEGER_TRACE_LOOKBACK_SEC:-600}")
if [[ -n "${TRACE_VALIDATION_REPORT_DIR:-}" ]]; then
  mkdir -p "${TRACE_VALIDATION_REPORT_DIR}"
  extra+=(--report-dir "${TRACE_VALIDATION_REPORT_DIR}")
fi

command -v node >/dev/null 2>&1 || {
  echo "verify-jaeger-trace-all-verticals: node is required" >&2
  exit 1
}

for f in "${FLOWS[@]}"; do
  echo "verify-jaeger-trace-all-verticals: ${f}"
  JAEGER_QUERY_BASE="$BASE" TRACE_FLOWS_JSON="${TRACE_FLOWS_JSON:-$REPO_ROOT/infra/observability/trace-flows.json}" \
    node "$SCRIPT_DIR/verify-jaeger-trace-flows.mjs" --flow "$f" "${extra[@]}" || exit 1
done

echo "verify-jaeger-trace-all-verticals: OK (${#FLOWS[@]} flows)"
