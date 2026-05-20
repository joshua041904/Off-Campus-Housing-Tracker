#!/usr/bin/env bash
# Insert landlord booking.cancelled notifications for tenant-cancelled bookings that lack one.
#
# Usage:
#   PGPASSWORD=postgres ./scripts/backfill-landlord-cancelled-notifications.sh
#   BOOKING_ID=65817e88-4996-4dc9-980c-dcdeb1f739bf ./scripts/backfill-landlord-cancelled-notifications.sh

set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BOOKINGS_PORT="${BOOKINGS_DB_PORT:-5443}"
NOTIF_PORT="${NOTIFICATION_DB_PORT:-5445}"
BOOKING_FILTER="${BOOKING_ID:-}"

where_booking=""
if [[ -n "$BOOKING_FILTER" ]]; then
  where_booking="AND b.id = '$BOOKING_FILTER'::uuid"
fi

rows=$(psql -h "$PGHOST" -p "$BOOKINGS_PORT" -U postgres -d bookings -tA -F $'\t' -v ON_ERROR_STOP=1 <<SQL
SELECT
  b.id::text,
  b.listing_id::text,
  b.landlord_id::text,
  b.tenant_id::text,
  COALESCE(b.listing_title_snapshot, ''),
  COALESCE(b.tenant_username_snapshot, ''),
  COALESCE(b.cancelled_at, b.updated_at, b.created_at)::text
FROM booking.bookings b
WHERE b.status = 'cancelled'::booking.booking_status
  AND (
    b.cancellation_reason ILIKE '%cancelled_by:tenant%'
    OR b.cancellation_reason ILIKE '%cancelled_by:renter%'
  )
  $where_booking;
SQL
)

if [[ -z "${rows// }" ]]; then
  echo "No tenant-cancelled bookings to backfill."
  exit 0
fi

inserted=0
skipped=0

while IFS=$'\t' read -r bid lid llid tid title tus cancelled_at; do
  [[ -z "$bid" ]] && continue
  bid_lc=$(echo "$bid" | tr '[:upper:]' '[:lower:]')
  lid_lc=$(echo "$lid" | tr '[:upper:]' '[:lower:]')
  llid_lc=$(echo "$llid" | tr '[:upper:]' '[:lower:]')
  tid_lc=$(echo "$tid" | tr '[:upper:]' '[:lower:]')
  dedupe="${llid_lc}:booking.cancelled:booking:${bid_lc}:CANCELLED"

  exists=$(psql -h "$PGHOST" -p "$NOTIF_PORT" -U postgres -d notification -tAc \
    "SELECT 1 FROM notification.notifications n
     WHERE n.user_id = '$llid'::uuid
       AND n.event_type = 'booking.cancelled'
       AND (
         n.dedupe_key = '$dedupe'
         OR lower(COALESCE(n.payload->>'booking_id', n.payload->>'bookingId', '')) = '$bid_lc'
       )
     LIMIT 1")

  if [[ "$exists" == "1" ]]; then
    echo "skip $bid (landlord notification exists)"
    skipped=$((skipped + 1))
    continue
  fi

  title_esc=${title//\'/\'\'}
  tus_esc=${tus//\'/\'\'}
  psql -h "$PGHOST" -p "$NOTIF_PORT" -U postgres -d notification -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO notification.notifications (user_id, event_type, channel, status, payload, dedupe_key, created_at)
VALUES (
  '$llid'::uuid,
  'booking.cancelled',
  'push'::notification.notification_channel,
  'pending',
  jsonb_build_object(
    'notification_audience', 'landlord',
    'notification_category', 'booking_landlord',
    'notification_recipient_role', 'landlord',
    'category', 'booking',
    'context_type', 'booking',
    'context_id', '$bid_lc',
    'booking_id', '$bid_lc',
    'bookingId', '$bid_lc',
    'listing_id', '$lid_lc',
    'landlord_id', '$llid_lc',
    'tenant_id', '$tid_lc',
    'new_status', 'CANCELLED',
    'booking_status', 'CANCELLED',
    'changed_by', 'tenant',
    'listing_title', '$title_esc',
    'tenant_username_snapshot', '$tus_esc',
    'deep_link', '/dashboard/bookings/$bid_lc',
    'source', 'backfill.landlord.cancelled'
  ),
  '$dedupe',
  COALESCE('$cancelled_at'::timestamptz, now())
);
SQL
  echo "inserted booking.cancelled for landlord $llid booking $bid"
  inserted=$((inserted + 1))
done <<< "$rows"

echo "Done: inserted=$inserted skipped=$skipped"
