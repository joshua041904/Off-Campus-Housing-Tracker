-- Tenant-editable notes on a booking (not listing description).
ALTER TABLE "booking"."bookings" ADD COLUMN IF NOT EXISTS "tenant_notes" TEXT;
