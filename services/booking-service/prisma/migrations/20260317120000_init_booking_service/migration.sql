CREATE SCHEMA IF NOT EXISTS booking;

CREATE TABLE IF NOT EXISTS booking.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  landlord_id UUID,
  status VARCHAR(40) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  cancelled_by VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON booking.bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_listing_id ON booking.bookings (listing_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON booking.bookings (status);

CREATE TABLE IF NOT EXISTS booking.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  query VARCHAR(256),
  min_price_cents INT,
  max_price_cents INT,
  max_distance_km INT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  filters JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_history_user_created
  ON booking.search_history (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking.watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  listing_id UUID NOT NULL,
  source VARCHAR(40),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_watchlist_user_listing
  ON booking.watchlist_items (user_id, listing_id);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_active_added
  ON booking.watchlist_items (user_id, is_active, added_at DESC);
