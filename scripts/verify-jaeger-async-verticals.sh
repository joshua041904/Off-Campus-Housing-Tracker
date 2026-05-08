#!/usr/bin/env bash
# Jaeger flows that include Kafka async hops (requireProducer / requireConsumer in trace-flows.json).
# Run after Playwright strict + seed so listing → analytics traces exist.
#
# Usage: JAEGER_QUERY_BASE=http://host:16686 ./scripts/verify-jaeger-async-verticals.sh
# Env: TRACE_FLOWS_JSON — default <repo>/infra/observability/trace-flows.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${JAEGER_QUERY_BASE:?Set JAEGER_QUERY_BASE (Jaeger query UI origin, e.g. http://host:16686)}"
BASE="${BASE%/}"
if [[ -x "$SCRIPT_DIR/preflight/kubectl-set-otel-always-on-step7.sh" ]]; then
  "$SCRIPT_DIR/preflight/kubectl-set-otel-always-on-step7.sh" || true
fi
FLOWS="${TRACE_FLOWS_JSON:-$REPO_ROOT/infra/observability/trace-flows.json}"

[[ -f "$FLOWS" ]] || {
  echo "verify-jaeger-async-verticals: missing flows file: $FLOWS" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "verify-jaeger-async-verticals: jq is required" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "verify-jaeger-async-verticals: node is required" >&2
  exit 1
}

extra=(--lookback "${JAEGER_TRACE_LOOKBACK_SEC:-600}")
if [[ -n "${TRACE_VALIDATION_REPORT_DIR:-}" ]]; then
  mkdir -p "${TRACE_VALIDATION_REPORT_DIR}"
  extra+=(--report-dir "${TRACE_VALIDATION_REPORT_DIR}")
fi

while IFS= read -r name; do
  [[ -z "${name}" ]] && continue
  echo "verify-jaeger-async-verticals: ${name}"
  JAEGER_QUERY_BASE="$BASE" TRACE_FLOWS_JSON="$FLOWS" node "$SCRIPT_DIR/verify-jaeger-trace-flows.mjs" \
    --flow "$name" \
    --flows-json "$FLOWS" \
    "${extra[@]}" || exit 1
done < <(jq -r '.flows[] | select((.requireProducer == true) or (.requireConsumer == true)) | select(.enabled != false) | .name' "$FLOWS")

echo "verify-jaeger-async-verticals: OK"
