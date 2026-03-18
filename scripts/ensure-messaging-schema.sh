#!/usr/bin/env bash
# Apply messaging schema to database 'messaging' on port 5444.
# Requires postgres-messaging up: docker compose up -d postgres-messaging
# Usage: PGPASSWORD=postgres ./scripts/ensure-messaging-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-messaging-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5444}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to messaging at $PGHOST:$PGPORT. Start postgres-messaging." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-messaging-outbox.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d messaging -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Messaging outbox (02) applied."
fi
echo "✅ Messaging schema applied (port $PGPORT, database messaging)."
