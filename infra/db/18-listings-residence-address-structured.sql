-- Listings: residence type, structured address, optional neighborhood, bedrooms/bathrooms columns.
-- Run: PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/18-listings-residence-address-structured.sql

ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS residence_type TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS state_or_province TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS bedrooms INTEGER;
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS bathrooms NUMERIC(4, 1);

COMMENT ON COLUMN listings.listings.residence_type IS 'apartment|house|townhouse|condo|studio|room|duplex|other';
COMMENT ON COLUMN listings.listings.neighborhood IS 'Optional public neighborhood label; use with display_location for privacy.';
COMMENT ON COLUMN listings.listings.address_line1 IS 'Exact street address; internal / landlord-only in API responses.';
COMMENT ON COLUMN listings.listings.bedrooms IS 'Structured bedroom count for search; title heuristics used as fallback when NULL.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'listings_residence_type_check'
  ) THEN
    ALTER TABLE listings.listings ADD CONSTRAINT listings_residence_type_check
      CHECK (
        residence_type IS NULL OR residence_type IN (
          'apartment', 'house', 'townhouse', 'condo', 'studio', 'room', 'duplex', 'other'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_residence_type ON listings.listings (residence_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_city_lower ON listings.listings (lower(city)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_state_lower ON listings.listings (lower(state_or_province)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_bedrooms ON listings.listings (bedrooms) WHERE deleted_at IS NULL AND bedrooms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_size_sqft ON listings.listings (size_sqft) WHERE deleted_at IS NULL AND size_sqft IS NOT NULL;

-- Backfill residence_type from copy
UPDATE listings.listings SET residence_type = 'studio'
WHERE residence_type IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ 'studio');
UPDATE listings.listings SET residence_type = 'room'
WHERE residence_type IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '\broom for rent\b' OR lower(title) LIKE '%room in shared%');
UPDATE listings.listings SET residence_type = 'townhouse'
WHERE residence_type IS NULL AND lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ 'townhouse|town house|town-home';
UPDATE listings.listings SET residence_type = 'condo'
WHERE residence_type IS NULL AND lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '\bcondo\b';
UPDATE listings.listings SET residence_type = 'duplex'
WHERE residence_type IS NULL AND lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '\bduplex\b';
UPDATE listings.listings SET residence_type = 'house'
WHERE residence_type IS NULL AND lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '\bhouse\b|\bsingle family\b|\bdfh\b';
UPDATE listings.listings SET residence_type = 'apartment'
WHERE residence_type IS NULL AND lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ 'apartment|apt\.|\bunit\b';
UPDATE listings.listings SET residence_type = 'other'
WHERE residence_type IS NULL;

-- Size: keep size_sqft; default a modest footprint when missing
UPDATE listings.listings SET size_sqft = 850 WHERE size_sqft IS NULL OR size_sqft <= 0;

-- City / state / country from display_location patterns (Amherst seed data)
UPDATE listings.listings
SET city = 'Amherst', state_or_province = 'MA', country = 'US'
WHERE (city IS NULL OR trim(city) = '')
  AND display_location IS NOT NULL
  AND display_location ILIKE '%amherst%';

UPDATE listings.listings
SET city = 'Hadley', state_or_province = 'MA', country = 'US'
WHERE (city IS NULL OR trim(city) = '')
  AND display_location IS NOT NULL
  AND display_location ILIKE '%hadley%';

UPDATE listings.listings
SET country = 'US'
WHERE country IS NULL OR trim(country) = '';

-- Public display line when we now have structured city/state
UPDATE listings.listings
SET display_location = trim(both ' ,' from concat_ws(', ',
  nullif(trim(neighborhood), ''),
  trim(both ' ,' from concat_ws(', ', nullif(trim(city), ''), nullif(trim(state_or_province), '')))
))
WHERE (display_location IS NULL OR trim(display_location) = '')
  AND city IS NOT NULL;

-- Bedrooms / baths heuristics (coarse)
UPDATE listings.listings SET bedrooms = 1
WHERE bedrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]1[[:space:]]*(bed|br)[[:>:]]');
UPDATE listings.listings SET bedrooms = 2
WHERE bedrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]2[[:space:]]*(bed|br)[[:>:]]');
UPDATE listings.listings SET bedrooms = 3
WHERE bedrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]3[[:space:]]*(bed|br)[[:>:]]');
UPDATE listings.listings SET bedrooms = 4
WHERE bedrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]4[[:space:]]*(bed|br)[[:>:]]');
UPDATE listings.listings SET bedrooms = 2 WHERE bedrooms IS NULL;

UPDATE listings.listings SET bathrooms = 1.0
WHERE bathrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]1[[:space:]]*(bath|ba)[[:>:]]');
UPDATE listings.listings SET bathrooms = 1.5
WHERE bathrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]1\.5[[:space:]]*(bath|ba)[[:>:]]');
UPDATE listings.listings SET bathrooms = 2.0
WHERE bathrooms IS NULL AND (lower(coalesce(title,'') || ' ' || coalesce(description,'')) ~ '[[:<:]]2[[:space:]]*(bath|ba)[[:>:]]');
UPDATE listings.listings SET bathrooms = 1.0 WHERE bathrooms IS NULL;

-- Richer search_norm including location fields
CREATE OR REPLACE FUNCTION listings.sync_search_norm()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_norm := lower(trim(
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.city, '') || ' ' ||
    coalesce(NEW.state_or_province, '') || ' ' ||
    coalesce(NEW.neighborhood, '') || ' ' ||
    coalesce(NEW.display_location, '')
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_listings_sync_search_norm ON listings.listings;
CREATE TRIGGER tr_listings_sync_search_norm
  BEFORE INSERT OR UPDATE OF title, description, city, state_or_province, neighborhood, display_location ON listings.listings
  FOR EACH ROW EXECUTE PROCEDURE listings.sync_search_norm();

UPDATE listings.listings SET search_norm = lower(trim(
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(city, '') || ' ' ||
    coalesce(state_or_province, '') || ' ' ||
    coalesce(neighborhood, '') || ' ' ||
    coalesce(display_location, '')
  )) WHERE search_norm IS NOT NULL OR title IS NOT NULL;
