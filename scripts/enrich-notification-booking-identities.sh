#!/usr/bin/env bash
# Enrich notification.notifications booking payloads with tenant identity from bookings DB.
#
#   BOOKINGS_DB_PORT=5443 NOTIFICATION_DB_PORT=5445 bash scripts/enrich-notification-booking-identities.sh
set -euo pipefail
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BOOKINGS_DB_PORT="${BOOKINGS_DB_PORT:-5443}"
NOTIFICATION_DB_PORT="${NOTIFICATION_DB_PORT:-5445}"

python3 <<'PY'
import json
import os
import subprocess

pguser = os.environ.get("PGUSER", "postgres")
pgpass = os.environ.get("PGPASSWORD", "postgres")
env = {**os.environ, "PGPASSWORD": pgpass}
bport = os.environ.get("BOOKINGS_DB_PORT", "5443")
nport = os.environ.get("NOTIFICATION_DB_PORT", "5445")
bu = f"postgresql://{pguser}@127.0.0.1:{bport}/bookings?connect_timeout=10"
nu = f"postgresql://{pguser}@127.0.0.1:{nport}/notification?connect_timeout=10"


def psql(url: str, sql: str) -> str:
    r = subprocess.run(
        ["psql", url, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return r.stdout


rows = [line for line in psql(bu, """
SELECT id::text, tenant_id::text,
       COALESCE(tenant_username_snapshot, ''),
       COALESCE(tenant_email_snapshot, '')
FROM booking.bookings
WHERE tenant_id IS NOT NULL;
""").splitlines() if line.strip()]

total = 0
for line in rows:
    parts = line.split("|")
    if len(parts) < 4:
        continue
    bid, tid, snap, email = parts[0], parts[1], parts[2], parts[3]
    patch = json.dumps(
        {
            "booking_id": bid,
            "bookingId": bid,
            "tenant_id": tid,
            "tenantId": tid,
            "renter_id": tid,
            "renterId": tid,
            "tenant_username_snapshot": snap or None,
            "tenantUsernameSnapshot": snap or None,
            "renter_username": snap or None,
            "tenant_email": email or None,
            "tenantEmail": email or None,
            "category": "booking",
            "context_type": "booking",
            "context_id": bid,
        },
    ).replace("'", "''")
    n = psql(
        nu,
        f"""
WITH updated AS (
  UPDATE notification.notifications n
  SET payload = n.payload || '{patch}'::jsonb
  WHERE event_type LIKE 'booking.%'
    AND (
      LOWER(COALESCE(n.payload->>'booking_id', n.payload->>'bookingId', '')) = '{bid}'
      OR LOWER(COALESCE(n.payload->>'context_id', '')) = '{bid}'
    )
  RETURNING 1
)
SELECT COUNT(*) FROM updated;
""",
    ).strip()
    total += int(n or "0")

print(f"Enriched {total} notification row(s) from bookings DB.")
PY
