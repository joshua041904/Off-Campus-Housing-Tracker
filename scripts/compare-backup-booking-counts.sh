#!/usr/bin/env bash
# Compare booking row counts across restore candidates (run on host with Postgres ports forwarded).
#
# Usage:
#   PGPASSWORD=postgres ./scripts/compare-backup-booking-counts.sh \
#     backups/all-8-20260517-130034 \
#     backups/all-8-20260517-152701 \
#     backups/all-8-20260517-185727

set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BOOKINGS_PORT="${BOOKINGS_DB_PORT:-5443}"
TENANT_FILTER="${TENANT_USERNAME:-tomwang04312}"
MAIN_BOOKING="${MAIN_BOOKING_ID:-65817e88-4996-4dc9-980c-dcdeb1f739bf}"

if [[ $# -lt 1 ]]; then
  echo "Pass one or more backup directories (e.g. backups/all-8-20260517-130034)."
  exit 1
fi

echo "Comparing backups (tenant username contains: $TENANT_FILTER, main booking: $MAIN_BOOKING)"
echo ""

for dir in "$@"; do
  name=$(basename "$dir")
  dump="$dir/bookings.dump"
  if [[ ! -f "$dump" ]]; then
    echo "$name: MISSING bookings.dump"
    continue
  fi
  total=$(pg_restore -l "$dump" 2>/dev/null | grep -c 'booking\.bookings' || echo 0)
  echo "=== $name ==="
  echo "  archive lists booking.bookings sections: $total"
  # Quick row count via pg_restore table data to temp db is heavy; use existing DB if restored:
  count=$(psql -h "$PGHOST" -p "$BOOKINGS_PORT" -U postgres -d bookings -tAc \
    "SELECT COUNT(*)::text FROM booking.bookings" 2>/dev/null || echo "?")
  echo "  live DB booking.bookings rows (current cluster): $count"
  row=$(psql -h "$PGHOST" -p "$BOOKINGS_PORT" -U postgres -d bookings -tA -F $'\t' -c \
    "SELECT id::text, status::text, COALESCE(cancelled_at::text,''), COALESCE(listing_title_snapshot,'')
     FROM booking.bookings
     WHERE id = '$MAIN_BOOKING'::uuid
     LIMIT 1" 2>/dev/null || true)
  if [[ -n "${row// }" ]]; then
    echo "  main booking in live DB: $row"
  else
    echo "  main booking in live DB: (not found — restore this backup first to inspect)"
  fi
  tom=$(psql -h "$PGHOST" -p "$BOOKINGS_PORT" -U postgres -d bookings -tAc \
    "SELECT COUNT(*)::text FROM booking.bookings
     WHERE COALESCE(tenant_username_snapshot,'') ILIKE '%${TENANT_FILTER}%'" 2>/dev/null || echo "?")
  echo "  tomwang-related rows in live DB: $tom"
  echo ""
done

echo "Tip: restore one backup at a time, then re-run this script to compare row-level state."
echo "Avoid backups with 0 bookings (e.g. all-8-20260517-185727). 130034, 152701, and 000810 were identical in prior probes."
