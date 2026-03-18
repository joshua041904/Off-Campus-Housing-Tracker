#!/usr/bin/env bash
# Apply notification schema to database 'notification' on port 5445.
# Requires postgres-notification up: docker compose up -d postgres-notification
# Usage: PGPASSWORD=postgres ./scripts/ensure-notification-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-notification-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5445}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d notification -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to notification at $PGHOST:$PGPORT. Start postgres-notification." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d notification -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-notification-idempotency.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d notification -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Notification idempotency (02) applied."
fi
echo "✅ Notification schema applied (port $PGPORT, database notification)."
