-- Landlord-visible reports tied to listings (moderation inbox).
CREATE TABLE IF NOT EXISTS listings.community_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID NOT NULL,
  listing_id   UUID NOT NULL REFERENCES listings.listings (id) ON DELETE CASCADE,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_reports_listing
  ON listings.community_reports (listing_id);

CREATE INDEX IF NOT EXISTS idx_community_reports_status
  ON listings.community_reports ((lower(status)));
