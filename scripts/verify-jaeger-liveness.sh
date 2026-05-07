#!/usr/bin/env bash
# Probes ${JAEGER_QUERY_BASE}/api/services. Resolves base via scripts/lib/jaeger-resolve-query-base.sh when unset or stale
# (JAEGER_PUBLIC_URL, edge https://off-campus-housing.test/jaeger, MetalLB svc). Loopback: optional port-forward
# (JAEGER_LIVENESS_AUTO_PORT_FORWARD=1 default). See scripts/lib/jaeger-local-port-forward.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/lib/jaeger-resolve-query-base.sh" ]] && source "$SCRIPT_DIR/lib/jaeger-resolve-query-base.sh"
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/lib/jaeger-local-port-forward.sh" ]] && source "$SCRIPT_DIR/lib/jaeger-local-port-forward.sh"

if command -v och_jaeger_resolve_query_base >/dev/null 2>&1; then
  och_jaeger_resolve_query_base || true
fi
: "${JAEGER_QUERY_BASE:?Set JAEGER_QUERY_BASE, JAEGER_PUBLIC_URL (e.g. MetalLB), or use edge https://off-campus-housing.test/jaeger (see scripts/lib/jaeger-resolve-query-base.sh)}"

if command -v och_jaeger_try_autopf >/dev/null 2>&1; then
  och_jaeger_try_autopf || true
fi

base="${JAEGER_QUERY_BASE%/}"
attempts="${JAEGER_LIVENESS_ATTEMPTS:-10}"
sleep_sec="${JAEGER_LIVENESS_SLEEP_SEC:-3}"

echo "Checking Jaeger liveness (${base}/api/services)..."
for i in $(seq 1 "$attempts"); do
  _ok=0
  if [[ "$base" == https:* ]]; then
    _ca="${NODE_EXTRA_CA_CERTS:-$REPO_ROOT/certs/dev-root.pem}"
    if [[ -f "$_ca" ]] && curl -sf --max-time 10 --cacert "$_ca" "${base}/api/services" >/dev/null; then
      _ok=1
    fi
  else
    curl -sf --max-time 10 "${base}/api/services" >/dev/null && _ok=1
  fi
  if [[ "$_ok" == "1" ]]; then
    echo "✅ Jaeger query API reachable"
    exit 0
  fi
  echo "Waiting for Jaeger (attempt ${i}/${attempts})..."
  [[ "$i" -lt "$attempts" ]] && sleep "$sleep_sec"
done

echo "❌ Jaeger unreachable after retries"
exit 1
