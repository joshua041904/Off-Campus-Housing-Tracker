-- Repair trust flag tables restored without status (01-trust-schema DROP TYPE CASCADE on existing rows).
-- Idempotent; safe after backups/all-8-* restore.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'trust' AND t.typname = 'flag_status'
  ) THEN
    CREATE TYPE trust.flag_status AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');
  END IF;
END $$;

ALTER TABLE trust.listing_flags
  ADD COLUMN IF NOT EXISTS status trust.flag_status NOT NULL DEFAULT 'pending';

ALTER TABLE trust.user_flags
  ADD COLUMN IF NOT EXISTS status trust.flag_status NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_listing_flags_status ON trust.listing_flags(status);
CREATE INDEX IF NOT EXISTS idx_user_flags_status ON trust.user_flags(status);
