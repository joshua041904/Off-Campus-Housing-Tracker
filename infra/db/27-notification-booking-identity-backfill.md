# Booking notification identity backfill

Cross-database enrichment (bookings → notification) is **not** a single-DB migration.
Run after deploy:

```bash
BOOKINGS_DB_PORT=5443 NOTIFICATION_DB_PORT=5445 \
  bash scripts/enrich-notification-booking-identities.sh
```

This copies `tenant_username_snapshot` / `tenant_email_snapshot` from `booking.bookings`
onto all `notification.notifications` rows for each `booking_id`.
