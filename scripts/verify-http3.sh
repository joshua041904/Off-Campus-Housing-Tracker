#!/usr/bin/env bash
# Edge HTTP/3 validation: prefer curl --http3 + http_version=3; accept alt-svc advertising h3 (QUIC advertised).
# Does not change Caddy — validation only.
#
# Env:
#   OCH_EDGE_HOSTNAME — default off-campus-housing.test
#   VERIFY_HTTP3_URL — full URL override (default https://$HOST/)
#   VERIFY_HTTP3_CACERT — PEM path (default $REPO_ROOT/certs/dev-root.pem); if missing, uses -k
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="${OCH_EDGE_HOSTNAME:-off-campus-housing.test}"
URL="${VERIFY_HTTP3_URL:-https://${HOST}/}"
CA="${VERIFY_HTTP3_CACERT:-$REPO_ROOT/certs/dev-root.pem}"
CURL=(curl -sS --connect-timeout 8 --max-time 35)
if [[ -f "$CA" ]]; then
  CURL+=(--cacert "$CA")
else
  CURL+=(-k)
fi

echo "verify-http3: probing ${URL} (curl --http3, http_version)"

ver="$("${CURL[@]}" --http3 -o /dev/null -w "%{http_version}" "$URL" 2>/dev/null || echo "")"
if [[ "$ver" == "3" ]]; then
  echo "✅ HTTP/3 OK (curl http_version=3)"
  exit 0
fi

echo "verify-http3: primary probe did not report HTTP/3 (http_version=${ver:-empty}); checking alt-svc…"

if "${CURL[@]}" -I --max-time 25 "$URL" 2>/dev/null | grep -i '^alt-svc:' | grep -qi 'h3'; then
  echo "✅ HTTP/3 OK (alt-svc advertises h3 — QUIC offered; client may negotiate HTTP/3)"
  exit 0
fi

echo "❌ HTTP/3 validation failed: no http_version=3 and no alt-svc h3=" >&2
exit 1
