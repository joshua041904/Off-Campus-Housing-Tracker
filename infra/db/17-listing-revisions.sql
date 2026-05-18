-- Landlord listing edit history (append-only revisions).
CREATE TABLE IF NOT EXISTS listings.listing_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  editor_user_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_revisions_listing_created
  ON listings.listing_revisions (listing_id, created_at DESC);
