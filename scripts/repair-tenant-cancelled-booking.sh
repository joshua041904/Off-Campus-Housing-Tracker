#!/usr/bin/env bash
# Mark a booking tenant-cancelled in DB and backfill landlord booking.cancelled notification.
#
# Use when renter cancelled in the app but DB still shows confirmed (restore gap / missed Kafka).
#
# Usage:
#   PGPASSWORD=postgres BOOKING_ID=65817e88-4996-4dc9-980c-dcdeb1f739bf ./scripts/repair-tenant-cancelled-booking.sh
#   DRY_RUN=1 BOOKING_ID=... ./scripts/repair-tenant-cancelled-booking.sh

set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BOOKINGS_PORT="${BOOKINGS_DB_PORT:-5443}"
BOOKING_ID="${BOOKING_ID:-65817e88-4996-4dc9-980c-dcdeb1f739bf}"
DRY_RUN="${DRY_RUN:-0}"

row=$(psql -h "$PGHOST" -p "$BOOKINGS_PORT" -U postgres -d bookings -tA -F $'\t' -v ON_ERROR_STOP=1 <<SQL
SELECT id::text, status::text, COALESCE(cancelled_at::text, ''), COALESCE(cancellation_reason, '')
FROM booking.bookings WHERE id = '$BOOKING_ID'::uuid;
SQL
)

if [[ -z "${row// }" ]]; then
  echo "Booking $BOOKING_ID not found in booking.bookings"
  exit 1
fi

IFS=$'\t' read -r bid status cancelled_at reason <<< "$row"
echo "Before: status=$status cancelled_at=${cancelled_at:-—} reason=${reason:-—}"

if [[ "$status" == "cancelled" && -n "$cancelled_at" ]]; then
  echo "Already cancelled; running notification backfill only."
else
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN: would UPDATE booking to cancelled with cancelled_by:tenant"
  else
    psql -h "$PGHOST" -p "$BOOKINGS_PORT" -U postgres -d bookings -v ON_ERROR_STOP=1 -q <<SQL
UPDATE booking.bookings
SET status = 'cancelled'::booking.booking_status,
    cancelled_at = COALESCE(cancelled_at, TIMESTAMPTZ '2026-05-14 03:26:26+00'),
    cancellation_reason = COALESCE(NULLIF(TRIM(cancellation_reason), ''), 'cancelled_by:tenant'),
    updated_at = now()
WHERE id = '$BOOKING_ID'::uuid;
SQL
    echo "Updated booking to cancelled."
  fi
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN: would run backfill-landlord-cancelled-notifications.sh"
  exit 0
fi

BOOKING_ID="$BOOKING_ID" "$(dirname "$0")/backfill-landlord-cancelled-notifications.sh"

echo "Done. Redeploy webapp + booking-service if needed; hard-refresh landlord dashboard."
