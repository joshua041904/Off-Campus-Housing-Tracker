-- Listings database: raw Postgres schema and tuning (no Prisma).
-- Run against database 'listings' on port 5442:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/01-listings-schema-and-tuning.sql
--
-- Auth (5441): auth.users has id (UUID), email, password_hash. Listings reference lister by user_id (no cross-DB FK).

-- Extensions (pg_trgm for trigram fuzzy search; pgcrypto for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Schema
CREATE SCHEMA IF NOT EXISTS listings;

-- Status as ENUM: prevents typos, clean proto mapping. Trust sets status='flagged' via Kafka (no cross-DB write).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'listing_status') THEN
    CREATE TYPE listings.listing_status AS ENUM ('active', 'paused', 'closed', 'flagged');
  END IF;
END $$;

-- Main table: one row per listing (house/apt). Booking/availability live in booking-service DB only.
CREATE TABLE IF NOT EXISTS listings.listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL,
  username_display   TEXT,
  title             TEXT,
  listed_at          DATE NOT NULL,
  price_cents        INTEGER NOT NULL,
  lease_length_months INTEGER,
  size_sqft          INTEGER,
  description       TEXT,
  amenities         JSONB DEFAULT '[]',
  smoke_free         BOOLEAN NOT NULL DEFAULT true,
  pet_friendly       BOOLEAN NOT NULL DEFAULT false,
  furnished          BOOLEAN,
  effective_from     DATE NOT NULL,
  effective_until    DATE,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed', 'flagged')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migrate status to ENUM if still TEXT (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'listings' AND c.table_name = 'listings' AND c.column_name = 'status'
    AND c.data_type = 'text'
  ) THEN
    ALTER TABLE listings.listings
      ALTER COLUMN status TYPE listings.listing_status USING (status::text::listings.listing_status);
  END IF;
END $$;

-- Soft delete: preserve history for analytics; all reads use WHERE deleted_at IS NULL
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Geo: location for listing (distance-from-campus, map). PostGIS optional later.
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Optimistic locking: version incremented on every update (listing edits, trust flag, status changes)
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Normalized text for trigram/KNN fuzzy search (title + description)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'search_norm'
  ) THEN
    ALTER TABLE listings.listings ADD COLUMN search_norm TEXT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_listings_search_norm_gin ON listings.listings USING gin (search_norm gin_trgm_ops);

-- Trigger to keep search_norm in sync for trigram search
CREATE OR REPLACE FUNCTION listings.sync_search_norm()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_norm := lower(trim(coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tr_listings_sync_search_norm ON listings.listings;
CREATE TRIGGER tr_listings_sync_search_norm
  BEFORE INSERT OR UPDATE OF title, description ON listings.listings
  FOR EACH ROW EXECUTE PROCEDURE listings.sync_search_norm();

COMMENT ON TABLE listings.listings IS 'Housing listings; user_id references auth.users.id on auth DB (5441). Trust: listing service consumes listing.flagged Kafka event and sets status=flagged (no cross-DB write).';
COMMENT ON COLUMN listings.listings.listed_at IS 'Listing date (mm-dd-yyyy).';
COMMENT ON COLUMN listings.listings.price_cents IS 'Rent in cents to avoid float.';
COMMENT ON COLUMN listings.listings.lease_length_months IS 'Lease length in months if fixed.';
COMMENT ON COLUMN listings.listings.effective_from IS 'When the listing becomes active.';
COMMENT ON COLUMN listings.listings.effective_until IS 'When the listing stops being effective (NULL = no end).';
COMMENT ON COLUMN listings.listings.deleted_at IS 'Soft delete; preserve for analytics. All reads filter deleted_at IS NULL.';
COMMENT ON COLUMN listings.listings.latitude IS 'Location: latitude (distance-from-campus, map).';
COMMENT ON COLUMN listings.listings.longitude IS 'Location: longitude.';
COMMENT ON COLUMN listings.listings.version IS 'Optimistic lock; increment on update.';

-- Media (images/videos) per listing
CREATE TABLE IF NOT EXISTS listings.listing_media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  media_type  TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  url_or_path TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_media_listing_id ON listings.listing_media(listing_id);

-- Composite indexes for common filters and sorts
CREATE INDEX IF NOT EXISTS idx_listings_user_created
  ON listings.listings(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listings_effective_dates
  ON listings.listings(effective_from, effective_until);

CREATE INDEX IF NOT EXISTS idx_listings_price_effective
  ON listings.listings(price_cents, effective_from);

CREATE INDEX IF NOT EXISTS idx_listings_smoke_pet
  ON listings.listings(smoke_free, pet_friendly)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_listings_status_effective_until
  ON listings.listings(status, effective_until)
  WHERE status = 'active' AND deleted_at IS NULL;

-- Partial index: active listings (date filtering in query; simpler than CURRENT_DATE in index)
CREATE INDEX IF NOT EXISTS idx_listings_active_effective
  ON listings.listings(effective_from, effective_until, price_cents)
  WHERE status = 'active' AND deleted_at IS NULL;

-- Geo: distance-from-campus / map (location service)
CREATE INDEX IF NOT EXISTS idx_listings_lat_lon
  ON listings.listings(latitude, longitude)
  WHERE status = 'active' AND deleted_at IS NULL;

-- Hash index for equality lookup on a stable key (e.g. by slug if we add one later)
-- Here we add a unique listing_code (optional) and hash index for exact lookup
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'listing_code'
  ) THEN
    ALTER TABLE listings.listings ADD COLUMN listing_code TEXT;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_listing_code ON listings.listings(listing_code) WHERE listing_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_listing_code_hash ON listings.listings USING hash(listing_code) WHERE listing_code IS NOT NULL;

-- GIN index for amenities (containment / key existence)
CREATE INDEX IF NOT EXISTS idx_listings_amenities_gin ON listings.listings USING GIN (amenities);

-- Primary search: trigram on search_norm only (no redundant tsvector GIN to keep write cost down)
DROP INDEX IF EXISTS listings.idx_listings_description_gin;

-- updated_at + version bump on UPDATE only (optimistic locking)
CREATE OR REPLACE FUNCTION listings.set_updated_at()
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

DROP TRIGGER IF EXISTS tr_listings_updated_at ON listings.listings;
CREATE TRIGGER tr_listings_updated_at
  BEFORE UPDATE ON listings.listings
  FOR EACH ROW EXECUTE PROCEDURE listings.set_updated_at();
