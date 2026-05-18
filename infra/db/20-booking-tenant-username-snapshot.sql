-- Renter handle snapshot at booking request time (from api-gateway x-user-username).
-- Run against bookings DB (same as other booking migrations).

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS tenant_username_snapshot VARCHAR(64);

COMMENT ON COLUMN booking.bookings.tenant_username_snapshot IS
  'Auth username/handle when the renter submitted the request (optional; complements tenant_email_snapshot).';
