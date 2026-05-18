-- Extend listing_status enum for soft-archive flows (works on Postgres without ADD VALUE IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    INNER JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'listings'
      AND t.typname = 'listing_status'
      AND e.enumlabel = 'archived'
  ) THEN
    ALTER TYPE listings.listing_status ADD VALUE 'archived';
  END IF;
END $$;
