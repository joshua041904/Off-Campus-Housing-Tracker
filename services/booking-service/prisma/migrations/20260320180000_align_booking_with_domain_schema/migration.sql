-- Align Prisma "bookings" table with infra/db/01-booking-schema.sql (booking.booking_status enum + pricing columns).
-- Safe to run on existing dev DBs; uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE SCHEMA IF NOT EXISTS booking;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
    CREATE TYPE booking.booking_status AS ENUM (
      'created',
      'pending_confirmation',
      'confirmed',
      'rejected',
      'cancelled',
      'expired',
      'completed'
    );
  END IF;
END $$;

-- Drop legacy varchar status column if present (from early Prisma migration) and replace with enum-backed column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'booking' AND table_name = 'bookings' AND column_name = 'status'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE booking.bookings DROP COLUMN status;
  END IF;
END $$;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS status booking.booking_status NOT NULL DEFAULT 'created';

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS landlord_id UUID;

UPDATE booking.bookings SET landlord_id = tenant_id WHERE landlord_id IS NULL;

ALTER TABLE booking.bookings
  ALTER COLUMN landlord_id SET NOT NULL;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS price_cents_snapshot INTEGER;

UPDATE booking.bookings SET price_cents_snapshot = 0 WHERE price_cents_snapshot IS NULL;

ALTER TABLE booking.bookings
  ALTER COLUMN price_cents_snapshot SET NOT NULL;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Drop Prisma-only cancelled_by if unused.
ALTER TABLE booking.bookings DROP COLUMN IF EXISTS cancelled_by;
