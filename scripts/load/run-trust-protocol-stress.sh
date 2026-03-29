#!/usr/bin/env bash
# Trust-only protocol matrix at higher VU: compare HTTP/1.1 vs HTTP/2 tail (waiting_p95 vs sending_p95 in summaries).
#
# Usage (repo root, cluster up, trust DB on 5446):
#   export DURATION=45s
#   export VUS=12
#   SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/load/run-trust-protocol-stress.sh
#
# Env:
#   TRUST_PG_SNAPSHOT_INTERVAL — seconds between Postgres connection snapshots (default 2; 0 = disable)
#   PGHOST PGPASSWORD PGUSER TRUST_DB_PORT — same as docker-compose external Postgres
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

export SSL_CERT_FILE="${SSL_CERT_FILE:-$REPO_ROOT/certs/dev-root.pem}"
export K6_TLS_CA_CERT="${K6_TLS_CA_CERT:-$SSL_CERT_FILE}"
export K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$SSL_CERT_FILE}"

DURATION="${DURATION:-45s}"
VUS="${VUS:-12}"
export DURATION VUS

TRUST_PG_SNAPSHOT_INTERVAL="${TRUST_PG_SNAPSHOT_INTERVAL:-2}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGUSER="${PGUSER:-postgres}"
TRUST_DB_PORT="${TRUST_DB_PORT:-5446}"
export PGPASSWORD

_poll_trust_connections() {
  psql -h "$PGHOST" -p "$TRUST_DB_PORT" -U "$PGUSER" -d trust -Atqc \
    "SELECT count(*)::text FROM pg_stat_activity WHERE datname = 'trust';" 2>/dev/null || echo "?"
}

_snap_pid=""

if [[ "$TRUST_PG_SNAPSHOT_INTERVAL" != "0" ]] && command -v psql >/dev/null 2>&1; then
  (
    while true; do
      echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') trust_pg_stat_activity_count=$(_poll_trust_connections)"
      sleep "$TRUST_PG_SNAPSHOT_INTERVAL"
    done
  ) &
  _snap_pid=$!
  trap '[[ -n "$_snap_pid" ]] && kill "$_snap_pid" 2>/dev/null || true' EXIT
elif [[ "$TRUST_PG_SNAPSHOT_INTERVAL" != "0" ]]; then
  echo "note: psql not on PATH — install client or set TRUST_PG_SNAPSHOT_INTERVAL=0 to silence" >&2
fi

echo "=== trust stress: DURATION=$DURATION VUS=$VUS (http1 then http2) ==="
"$SCRIPT_DIR/run-k6-protocol-matrix.sh" http1 trust
"$SCRIPT_DIR/run-k6-protocol-matrix.sh" http2 trust

echo ""
echo "Compare summaries under protocol-matrix/http1/trust-summary.json vs http2/trust-summary.json"
echo "  jq '.metrics | {http_req_waiting, http_req_sending, http_req_duration}' < .../trust-summary.json"
