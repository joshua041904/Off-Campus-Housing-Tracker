-- Persist fraud assessment + listing/tenant snapshot for operational dashboards.

ALTER TABLE "booking"."bookings"
ADD COLUMN IF NOT EXISTS "fraud_score" INTEGER,
ADD COLUMN IF NOT EXISTS "fraud_flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "fraud_signals" JSONB,
ADD COLUMN IF NOT EXISTS "listing_title_snapshot" VARCHAR(512),
ADD COLUMN IF NOT EXISTS "tenant_email_snapshot" VARCHAR(320),
ADD COLUMN IF NOT EXISTS "fraud_review_status" VARCHAR(32);

CREATE INDEX IF NOT EXISTS "idx_bookings_fraud_flagged_landlord"
ON "booking"."bookings" ("landlord_id", "fraud_flagged", "created_at" DESC);
