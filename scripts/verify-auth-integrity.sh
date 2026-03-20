#!/usr/bin/env bash
# Verify auth DB has expected schema (tables from dump + outbox_events). Run after restore-auth-db.sh.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/verify-auth-integrity.sh
#   VERIFY_HOST=127.0.0.1 PGPASSWORD=postgres ./scripts/verify-auth-integrity.sh

set -euo pipefail

HOST="${VERIFY_HOST:-${PGHOST:-127.0.0.1}}"
PORT="${VERIFY_PORT:-${PGPORT:-5441}}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

echo "🔎 Verifying auth integrity at $HOST:$PORT..."

TABLES=$(psql -h "$HOST" -p "$PORT" -U postgres -d auth -t -A -v ON_ERROR_STOP=1 -c "
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'auth';
" | tr -d ' \r\n')

if [[ -z "$TABLES" ]] || [[ "$TABLES" -lt 8 ]]; then
  echo "❌ Auth schema incomplete (found ${TABLES:-0} tables in auth schema; expected >= 8)." >&2
  exit 1
fi

OUTBOX=$(psql -h "$HOST" -p "$PORT" -U postgres -d auth -t -A -v ON_ERROR_STOP=1 -c "
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'auth' AND table_name = 'outbox_events';
" | tr -d ' \r\n')

if [[ -z "$OUTBOX" ]] || [[ "$OUTBOX" -eq 0 ]]; then
  echo "❌ Missing auth.outbox_events table." >&2
  exit 1
fi

echo "✅ Auth integrity verified (${TABLES} tables, outbox_events present)."
