-- Tenant-only hide-from-list for terminal bookings (does not delete the row).
ALTER TABLE "booking"."bookings"
  ADD COLUMN IF NOT EXISTS "tenant_archived_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_bookings_tenant_archived_at"
  ON "booking"."bookings" ("tenant_id", "tenant_archived_at");
