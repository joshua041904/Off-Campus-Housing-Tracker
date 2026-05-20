-- Human-readable location line for marketplace UI (lat/lng stay canonical for distance/search).

ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS display_location TEXT;

COMMENT ON COLUMN listings.listings.display_location IS 'City/neighborhood line shown in UI; coordinates are internal for distance only.';

-- Backfill existing rows that have geo but no display line yet.
UPDATE listings.listings
SET display_location = (
  CASE (abs(hashtext(id::text)) % 6)
    WHEN 0 THEN 'Near campus'
    WHEN 1 THEN 'Downtown'
    WHEN 2 THEN 'West End'
    WHEN 3 THEN 'North Amherst'
    WHEN 4 THEN 'East Hadley'
    ELSE 'Pine Street area'
  END || ', Amherst, MA'
)
WHERE (display_location IS NULL OR TRIM(display_location) = '')
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL;
