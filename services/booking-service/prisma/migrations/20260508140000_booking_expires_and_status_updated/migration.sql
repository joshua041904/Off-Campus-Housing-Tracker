-- Booking lifecycle metadata for expiry guards + audit timestamps.

ALTER TABLE "booking"."bookings"
ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "status_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

UPDATE "booking"."bookings"
SET "status_updated_at" = COALESCE("updated_at", "created_at")
WHERE TRUE;

UPDATE "booking"."bookings"
SET "expires_at" = "created_at" + INTERVAL '48 hours'
WHERE "expires_at" IS NULL AND "status"::text = 'created';
