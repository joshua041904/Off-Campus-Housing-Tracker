#!/usr/bin/env bash
# Smoke Geocoding API with repo key (dev). Quota warnings are non-fatal.
#
# Env (first non-empty wins):
#   GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
#   BOOTSTRAP_SKIP_MAPS_VERIFY=1, PREFLIGHT_SKIP_MAPS_VERIFY=1 — skip
#   MAPS_VERIFY_REQUIRE_KEY=1 — exit 1 if no key (default in bootstrap); unset/0 allows skip-with-warning when no key
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "${BOOTSTRAP_SKIP_MAPS_VERIFY:-0}" == "1" || "${PREFLIGHT_SKIP_MAPS_VERIFY:-0}" == "1" ]]; then
  echo "verify-google-maps: skipped (BOOTSTRAP_SKIP_MAPS_VERIFY / PREFLIGHT_SKIP_MAPS_VERIFY)"
  exit 0
fi

API_KEY="${GOOGLE_MAPS_API_KEY:-}"
API_KEY="${API_KEY:-${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}}"
if [[ -z "$API_KEY" && -f "$REPO_ROOT/webapp/.env.local" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=*|GOOGLE_MAPS_API_KEY=*)
        API_KEY="${line#*=}"
        API_KEY="${API_KEY%$'\r'}"
        API_KEY="${API_KEY#\"}"
        API_KEY="${API_KEY%\"}"
        ;;
    esac
  done <"$REPO_ROOT/webapp/.env.local"
fi

if [[ -z "$API_KEY" ]]; then
  if [[ "${MAPS_VERIFY_REQUIRE_KEY:-1}" == "1" ]]; then
    echo "::error::verify-google-maps: missing API key (GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, or webapp/.env.local)" >&2
    exit 1
  fi
  echo "verify-google-maps: no key — skip (MAPS_VERIFY_REQUIRE_KEY=0)"
  exit 0
fi

command -v jq >/dev/null 2>&1 || {
  echo "::error::verify-google-maps: jq required" >&2
  exit 1
}

echo "verify-google-maps: Geocoding API smoke (New York)…"
RESP="$(curl -sS --connect-timeout 10 --max-time 30 \
  "https://maps.googleapis.com/maps/api/geocode/json?address=New+York&key=${API_KEY}")"

if echo "$RESP" | grep -q "OVER_QUERY_LIMIT"; then
  echo "⚠️  verify-google-maps: OVER_QUERY_LIMIT in response body (quota)" >&2
fi

STATUS="$(echo "$RESP" | jq -r '.status // empty')"
if [[ "$STATUS" != "OK" ]]; then
  echo "::error::verify-google-maps: Geocode status=$STATUS" >&2
  echo "$RESP" | head -c 1200 >&2 || true
  exit 1
fi

echo "✅ verify-google-maps: Geocode API OK"
