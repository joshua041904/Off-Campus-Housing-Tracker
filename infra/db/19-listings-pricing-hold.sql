-- Listing negotiation + temporary availability hold (listings DB).
-- Apply with: psql "$POSTGRES_URL_LISTINGS" -f infra/db/19-listings-pricing-hold.sql

ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed';
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS soft_hold_until timestamptz NULL;

ALTER TABLE listings.listings DROP CONSTRAINT IF EXISTS listings_pricing_mode_chk;
ALTER TABLE listings.listings
  ADD CONSTRAINT listings_pricing_mode_chk CHECK (pricing_mode IN ('fixed', 'obo'));

COMMENT ON COLUMN listings.listings.pricing_mode IS 'fixed = advertised price; obo = open to / best offer.';
COMMENT ON COLUMN listings.listings.soft_hold_until IS 'When set and in the future, listing is on soft hold (hidden from marketplace search; booking-service blocks new requests).';

CREATE INDEX IF NOT EXISTS idx_listings_soft_hold_until
  ON listings.listings (soft_hold_until)
  WHERE deleted_at IS NULL AND soft_hold_until IS NOT NULL;
