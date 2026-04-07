-- Booking service DB: consumer-driven request lifecycle (tenant requests time on listing).
-- Run against database 'bookings' on port 5443:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5443 -U postgres -d bookings -f infra/db/01-booking-schema.sql
--
-- No cross-DB FKs. tenant_id and landlord_id are auth service user UUIDs (reference only).
-- listing_id is UUID reference to listings DB; never FK across services.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS booking;

-- Booking status: request lifecycle, landlord approval, cancellation, completion
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

CREATE TABLE IF NOT EXISTS booking.bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id           UUID NOT NULL,
  tenant_id            UUID NOT NULL,
  landlord_id          UUID NOT NULL,

  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,

  status               booking.booking_status NOT NULL DEFAULT 'created',

  price_cents_snapshot INTEGER NOT NULL,
  currency_code        TEXT NOT NULL DEFAULT 'USD',

  cancellation_reason  TEXT,
  tenant_notes         TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,

  version              INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE booking.bookings ADD COLUMN IF NOT EXISTS tenant_notes TEXT;

COMMENT ON TABLE booking.bookings IS 'Tenant requests on listings. tenant_id/landlord_id = auth users; listing_id = reference to listings DB (no FK).';
COMMENT ON COLUMN booking.bookings.price_cents_snapshot IS 'Price at time of booking; immutable. Never join to listing for price at payment.';
COMMENT ON COLUMN booking.bookings.tenant_id IS 'Auth service user id (consumer).';
COMMENT ON COLUMN booking.bookings.landlord_id IS 'Auth service user id (listing owner).';

-- Prevent double booking: no overlapping date ranges for same listing when status is confirmed or pending_confirmation
ALTER TABLE booking.bookings
  DROP CONSTRAINT IF EXISTS no_overlapping_bookings;

ALTER TABLE booking.bookings
  ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist (
    listing_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
  WHERE (status IN ('confirmed', 'pending_confirmation'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_booking_tenant
  ON booking.bookings(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_landlord
  ON booking.bookings(landlord_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_listing_status
  ON booking.bookings(listing_id, status);

CREATE INDEX IF NOT EXISTS idx_booking_status_dates
  ON booking.bookings(status, start_date);

-- Optional: payment placeholder (future-ready)
ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- updated_at + version bump (optimistic locking)
CREATE OR REPLACE FUNCTION booking.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF TG_OP = 'UPDATE' THEN
    NEW.version = OLD.version + 1;
  ELSIF TG_OP = 'INSERT' AND (NEW.version IS NULL OR NEW.version < 1) THEN
    NEW.version := 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_booking_updated_at ON booking.bookings;
CREATE TRIGGER tr_booking_updated_at
  BEFORE UPDATE ON booking.bookings
  FOR EACH ROW EXECUTE PROCEDURE booking.set_updated_at();
