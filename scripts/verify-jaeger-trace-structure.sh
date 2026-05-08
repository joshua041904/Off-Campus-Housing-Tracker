#!/usr/bin/env bash
# Per-vertical trace contract: one coherent trace (seed service + api-gateway on same trace),
# structural integrity (single root, non-roots have parent refs), positive durations.
# Does NOT require every backend on one trace — global service list: verify-jaeger-tracing-services.sh.
# Preflight/CI structural batch: verify-jaeger-trace-all-verticals.sh (subset: strict-suite deterministic flows only).
#
# Usage: JAEGER_QUERY_BASE=http://host:16686 ./scripts/verify-jaeger-trace-structure.sh [vertical]
#   vertical: booking | messaging | listings | media | trust | analytics | auth | notification (default: booking)
#   or set JAEGER_TRACE_VERTICAL instead of argv.
#   Generic: ./scripts/verify-jaeger-trace-structure.sh --flow <name> [--flows-json PATH]
#            ./scripts/verify-jaeger-trace-structure.sh --services a,b --seed-service b [--require-producer] …
#            ./scripts/verify-jaeger-trace-structure.sh --list-flows
#
# Required env: JAEGER_QUERY_BASE
# Fixed timing: LOOKBACK 180s, RETRIES 8, SLEEP 3s, LIMIT 5 (edit script to tune).
# JAEGER_REJECT_HTTP_5XX_IN_PAYLOAD=1 — fail if any span tag http.status_code is 5xx (strict suite hygiene).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Generic N-service / JSON flows (see infra/observability/trace-flows.json).
if [[ "${1:-}" == "--flow" ]] || [[ "${1:-}" == "--services" ]] || [[ "${1:-}" == "--list-flows" ]]; then
  command -v node >/dev/null 2>&1 || {
    echo "verify-jaeger-trace-structure: node is required for --flow/--services/--list-flows" >&2
    exit 1
  }
  exec node "$SCRIPT_DIR/verify-jaeger-trace-flows.mjs" "$@"
fi

command -v jq >/dev/null 2>&1 || {
  echo "verify-jaeger-trace-structure: jq is required (brew install jq / apt install jq)" >&2
  exit 1
}

BASE="${JAEGER_QUERY_BASE:?Set JAEGER_QUERY_BASE (Jaeger query UI origin, e.g. http://host:16686)}"
BASE="${BASE%/}"

VERTICAL="${1:-${JAEGER_TRACE_VERTICAL:-booking}}"
case "$VERTICAL" in
  booking)
    SERVICE="booking-service"
    REQUIRED_RAW="api-gateway,booking-service"
    ;;
  messaging)
    SERVICE="messaging-service"
    REQUIRED_RAW="api-gateway,messaging-service"
    ;;
  listings)
    SERVICE="listings-service"
    REQUIRED_RAW="api-gateway,listings-service"
    ;;
  media)
    SERVICE="media-service"
    REQUIRED_RAW="api-gateway,media-service"
    ;;
  trust)
    SERVICE="trust-service"
    REQUIRED_RAW="api-gateway,trust-service"
    ;;
  analytics)
    SERVICE="analytics-service"
    REQUIRED_RAW="api-gateway,analytics-service"
    ;;
  auth)
    SERVICE="auth-service"
    REQUIRED_RAW="api-gateway,auth-service"
    ;;
  notification)
    SERVICE="notification-service"
    REQUIRED_RAW="api-gateway,notification-service"
    ;;
  *)
    echo "verify-jaeger-trace-structure: unknown vertical '${VERTICAL}' — booking|messaging|listings|media|trust|analytics|auth|notification" >&2
    exit 1
    ;;
esac

LOOKBACK=180
LIMIT=5
RETRIES=8
SLEEP=3

tmp="$(mktemp)"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

fetch_traces() {
  local end_us start_us enc url
  end_us=$(( $(date +%s) * 1000000 ))
  start_us=$(( ($(date +%s) - LOOKBACK) * 1000000 ))
  enc="$(printf '%s' "$SERVICE" | jq -sRr @uri)"
  url="${BASE}/api/traces?service=${enc}&start=${start_us}&end=${end_us}&limit=${LIMIT}"
  if ! curl -sfS --max-time 45 "$url" -o "$tmp"; then
    echo "verify-jaeger-trace-structure: GET /api/traces failed vertical=${VERTICAL} service=${SERVICE}" >&2
    return 1
  fi
  return 0
}

# Exit 0 if $tmp passes all invariants; else exit 1 with message on stderr.
validate_payload() {
  if ! jq -e '.data | type == "array"' "$tmp" >/dev/null 2>&1; then
    echo "verify-jaeger-trace-structure: response missing .data array (vertical=${VERTICAL})" >&2
    return 1
  fi

  local n
  n="$(jq '.data | length' "$tmp")"
  if [[ "${n:-0}" -lt 1 ]]; then
    echo "verify-jaeger-trace-structure: no traces in lookback (vertical=${VERTICAL} service=${SERVICE})" >&2
    return 1
  fi

  local bad_dur bad_start
  bad_dur="$(jq '[.data[]?.spans[]? | select((.duration // 0) <= 0)] | length' "$tmp")"
  if [[ "${bad_dur:-0}" -gt 0 ]]; then
    jq -c '[.data[]?.spans[]? | select((.duration // 0) <= 0) | {operationName, duration, traceID}] | .[0:5]' "$tmp" >&2 || true
    echo "verify-jaeger-trace-structure: vertical=${VERTICAL} — ${bad_dur} span(s) duration <= 0" >&2
    return 1
  fi

  bad_start="$(jq '[.data[]?.spans[]? | select((.startTime // 0) <= 0)] | length' "$tmp")"
  if [[ "${bad_start:-0}" -gt 0 ]]; then
    echo "verify-jaeger-trace-structure: vertical=${VERTICAL} — invalid startTime" >&2
    return 1
  fi

  if [[ "${JAEGER_REJECT_HTTP_5XX_IN_PAYLOAD:-0}" == "1" ]]; then
    _5xx="$(jq '[.data[]?.spans[]? | (.tags // [])[]? | select(.key == "http.status_code") | (.value | tonumber? // empty) | select(. >= 500)] | length' "$tmp")"
    if [[ "${_5xx:-0}" -gt 0 ]]; then
      echo "verify-jaeger-trace-structure: vertical=${VERTICAL} — ${_5xx} span(s) with http.status_code >= 500" >&2
      return 1
    fi
  fi

  local tid
  tid="$(jq -r --arg need "$REQUIRED_RAW" '
    ($need | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))) as $req |
    (.data // [])[] as $t |
    select(($t.spans | length) > 1) |
    ($t.processes) as $p |
    ([$t.spans[] | $p[.processID].serviceName] | unique) as $svcs |
    select(all($req[]; . as $n | ($svcs | contains([$n])))) |
    select(any($t.spans[];
      (.operationName | type == "string") and (
        (.operationName | test("HTTP\\s+(GET|POST|PUT|PATCH|DELETE)"; "i"))
        or (.operationName | ascii_downcase | contains("booking"))
        or (.operationName | ascii_downcase | contains("grpc"))
        or (.operationName | ascii_downcase | contains("listing"))
        or (.operationName | ascii_downcase | contains("message"))
        or (.operationName | ascii_downcase | contains("forum"))
        or (.operationName | ascii_downcase | contains("trust"))
        or (.operationName | ascii_downcase | contains("flag"))
        or (.operationName | ascii_downcase | contains("media"))
        or (.operationName | ascii_downcase | contains("health"))
        or (.operationName | ascii_downcase | contains("analytics"))
        or (.operationName | ascii_downcase | contains("insight"))
        or (.operationName | ascii_downcase | contains("metric"))
        or (.operationName | ascii_downcase | contains("auth"))
        or (.operationName | ascii_downcase | contains("login"))
        or (.operationName | ascii_downcase | contains("register"))
        or (.operationName | ascii_downcase | contains("passkey"))
        or (.operationName | ascii_downcase | contains("notif"))
        or (.operationName | ascii_downcase | contains("preference"))
      )
    )) |
    $t.traceID
  ' "$tmp" | head -1)"

  if [[ -z "${tid}" || "${tid}" == "null" ]]; then
    echo "verify-jaeger-trace-structure: vertical=${VERTICAL} no trace: spans>1, services=[${REQUIRED_RAW}], op pattern" >&2
    jq -r '.data[0] | (.processes // {}) | to_entries[] | .value.serviceName' "$tmp" 2>/dev/null | sort -u | head -20 >&2 || true
    return 1
  fi

  # Exactly one root; every other span must have at least one reference (parent context).
  if ! jq -e --arg tid "$tid" '
    (.data[] | select(.traceID == $tid)) as $t |
    ($t.spans) as $spans |
    ([$spans[] | select((.references // []) | length == 0)]) as $roots |
    ($roots | length == 1)
    and
    (($roots[0].spanID | tostring) as $rid |
      all($spans[]; ((.references // []) | length > 0) or ((.spanID | tostring) == $rid))
    )
  ' "$tmp" >/dev/null 2>&1; then
    echo "verify-jaeger-trace-structure: vertical=${VERTICAL} trace ${tid} — need exactly 1 root (empty references) and every non-root must have references" >&2
    jq -c --arg tid "$tid" '.data[] | select(.traceID == $tid) | .spans[] | {spanID, references, operationName}' "$tmp" 2>/dev/null | head -30 >&2 || true
    return 1
  fi

  echo "verify-jaeger-trace-structure: OK vertical=${VERTICAL} traceID=${tid} services=[${REQUIRED_RAW}] 1-root non-roots-have-refs"
  return 0
}

attempt=1
while [[ "$attempt" -le "$RETRIES" ]]; do
  echo "verify-jaeger-trace-structure: vertical=${VERTICAL} attempt ${attempt}/${RETRIES} (seed=${SERVICE}, lookback=${LOOKBACK}s)"
  if fetch_traces && validate_payload; then
    exit 0
  fi
  if [[ "$attempt" -lt "$RETRIES" ]]; then
    sleep "$SLEEP"
  fi
  attempt=$((attempt + 1))
done

echo "verify-jaeger-trace-structure: vertical=${VERTICAL} failed after ${RETRIES} attempts" >&2
exit 1
