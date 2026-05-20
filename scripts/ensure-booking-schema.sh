#!/usr/bin/env bash
# Apply booking schema to database 'bookings' on port 5443.
# Requires postgres-bookings up: docker compose up -d postgres-bookings
# Usage: PGPASSWORD=postgres ./scripts/ensure-booking-schema.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SQL="$REPO_ROOT/infra/db/01-booking-schema.sql"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5443}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found" >&2
  exit 1
fi
if ! psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to bookings at $PGHOST:$PGPORT. Start postgres-bookings." >&2
  exit 1
fi
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL"
SQL2="$REPO_ROOT/infra/db/02-booking-state-machine.sql"
if [[ -f "$SQL2" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL2"
  echo "✅ Booking state machine (02) applied."
fi
SQL3="$REPO_ROOT/infra/db/03-booking-outbox.sql"
if [[ -f "$SQL3" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL3"
  echo "✅ Booking outbox (03) applied."
fi
SQL06="$REPO_ROOT/infra/db/06-booking-processed-events.sql"
if [[ -f "$SQL06" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL06"
  echo "✅ Booking processed_events (06) applied."
fi
SQL04="$REPO_ROOT/infra/db/04-booking-search-history.sql"
if [[ -f "$SQL04" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL04"
  echo "✅ Booking search history (04) applied."
fi
SQL05="$REPO_ROOT/infra/db/05-booking-prisma-columns.sql"
if [[ -f "$SQL05" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL05"
  echo "✅ Booking Prisma columns (05) applied."
fi
SQL19="$REPO_ROOT/infra/db/19-booking-search-history-alerts.sql"
if [[ -f "$SQL19" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL19"
  echo "✅ Booking search-history alerts (19) applied."
fi
SQL20="$REPO_ROOT/infra/db/20-booking-tenant-username-snapshot.sql"
if [[ -f "$SQL20" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -f "$SQL20"
  echo "✅ Booking tenant username snapshot (20) applied."
fi
echo "✅ Booking schema applied (port $PGPORT, database bookings)."
