#!/usr/bin/env bash
# Apply analytics schema to database 'analytics' on port 5447.
# Requires postgres-analytics up: docker compose up -d postgres-analytics
# Usage: PGPASSWORD=postgres ./scripts/ensure-analytics-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-analytics-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5447}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to analytics at $PGHOST:$PGPORT. Start postgres-analytics." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-analytics-projections.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Analytics projections (02) applied."
fi
SQL3="$REPO_ROOT/infra/db/03-analytics-recommendation.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d analytics -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Analytics recommendation (03) applied."
fi
echo "✅ Analytics schema applied (port $PGPORT, database analytics)."