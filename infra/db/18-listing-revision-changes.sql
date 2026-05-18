-- Optional field-level summary for each landlord listing revision (paired with snapshot = before-state).
ALTER TABLE listings.listing_revisions
  ADD COLUMN IF NOT EXISTS changes JSONB;
