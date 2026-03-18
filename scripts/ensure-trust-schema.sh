#!/usr/bin/env bash
# Apply trust schema to database 'trust' on port 5446.
# Requires postgres-trust up: docker compose up -d postgres-trust
# Usage: PGPASSWORD=postgres ./scripts/ensure-trust-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-trust-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5446}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d trust -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to trust at $PGHOST:$PGPORT. Start postgres-trust." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d trust -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-trust-scoring.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d trust -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Trust scoring (02) applied."
fi
SQL3="$REPO_ROOT/infra/db/03-trust-outbox.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d trust -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Trust outbox (03) applied."
fi
echo "✅ Trust schema applied (port $PGPORT, database trust)."
