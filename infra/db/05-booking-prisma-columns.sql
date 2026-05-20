-- Align booking.bookings with booking-service Prisma schema (infra-only DBs skip prisma migrate).
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE booking.bookings
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS fraud_score INTEGER,
  ADD COLUMN IF NOT EXISTS fraud_flagged BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fraud_signals JSONB,
  ADD COLUMN IF NOT EXISTS listing_title_snapshot VARCHAR(512),
  ADD COLUMN IF NOT EXISTS tenant_email_snapshot VARCHAR(320),
  ADD COLUMN IF NOT EXISTS fraud_review_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS tenant_archived_at TIMESTAMPTZ;

UPDATE booking.bookings
SET status_updated_at = COALESCE(updated_at, created_at)
WHERE status_updated_at IS NULL;

UPDATE booking.bookings
SET expires_at = created_at + INTERVAL '48 hours'
WHERE expires_at IS NULL AND status::text = 'created';

CREATE INDEX IF NOT EXISTS idx_bookings_fraud_flagged_landlord
  ON booking.bookings (landlord_id, fraud_flagged, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_archived_at
  ON booking.bookings (tenant_id, tenant_archived_at);
