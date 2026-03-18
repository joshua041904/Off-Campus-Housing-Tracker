#!/usr/bin/env bash
# Apply auth outbox table to database 'auth' on port 5441.
# Auth DB may be restored from dump; this script is idempotent. Run after auth DB is available.
# Usage: PGPASSWORD=postgres ./scripts/ensure-auth-outbox.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-auth-outbox.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5441}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d auth -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to auth at $PGHOST:$PGPORT. Start postgres-auth." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d auth -v ON_ERROR_STOP=1 -f "$SQL"
echo "✅ Auth outbox applied (port $PGPORT, database auth)."
