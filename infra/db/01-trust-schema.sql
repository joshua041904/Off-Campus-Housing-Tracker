-- Trust service DB: moderation, flags, reviews, reputation, suspension. No cross-DB writes.
-- Run against database 'trust' on port 5446:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5446 -U postgres -d trust -f infra/db/01-trust-schema.sql
--
-- Trust does NOT mutate other service DBs. It emits events (listing.flagged, user.warned, review.created, reputation.updated).
-- Listing/booking/notification services consume and update their own state.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS trust;

-- Migrate from previous single flags/reviews design: drop old objects so this script is idempotent
DROP TABLE IF EXISTS trust.reviews CASCADE;
DROP TABLE IF EXISTS trust.flags CASCADE;
DROP TYPE IF EXISTS trust.flag_target_type CASCADE;
DROP TYPE IF EXISTS trust.flag_status CASCADE;

-- Flag status: moderation workflow (pending → reviewed → resolved | dismissed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'flag_status') THEN
    CREATE TYPE trust.flag_status AS ENUM (
      'pending',
      'reviewed',
      'resolved',
      'dismissed'
    );
  END IF;
END $$;

-- 1) Listing flags — one listing can be flagged multiple times
CREATE TABLE IF NOT EXISTS trust.listing_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     UUID NOT NULL,
  reporter_id    UUID NOT NULL,
  reason         TEXT NOT NULL,
  description    TEXT,
  status         trust.flag_status NOT NULL DEFAULT 'pending',
  reviewed_by    UUID,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.listing_flags IS 'Flags on listings. When resolved as confirmed, Trust emits listing.flagged; listing service sets status=flagged.';
CREATE INDEX IF NOT EXISTS idx_listing_flags_listing ON trust.listing_flags(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_flags_status ON trust.listing_flags(status);
CREATE INDEX IF NOT EXISTS idx_listing_flags_reporter ON trust.listing_flags(reporter_id, created_at DESC);

-- 2) User flags — abusive tenants or landlords
CREATE TABLE IF NOT EXISTS trust.user_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  reporter_id    UUID NOT NULL,
  reason         TEXT NOT NULL,
  description    TEXT,
  status         trust.flag_status NOT NULL DEFAULT 'pending',
  reviewed_by    UUID,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.user_flags IS 'Flags on users. Trust may emit user.warned or user.suspended; auth/listings/booking react via events.';
CREATE INDEX IF NOT EXISTS idx_user_flags_user ON trust.user_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_user_flags_status ON trust.user_flags(status);
CREATE INDEX IF NOT EXISTS idx_user_flags_reporter ON trust.user_flags(reporter_id, created_at DESC);

-- 3) Review target: listing or user (reviewee)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_target_type') THEN
    CREATE TYPE trust.review_target_type AS ENUM (
      'listing',
      'user'
    );
  END IF;
END $$;

-- Reviews — only after booking.completed; Trust consumes event, stores review, does not touch booking DB
CREATE TABLE IF NOT EXISTS trust.reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID NOT NULL,
  reviewer_id       UUID NOT NULL,
  target_type       trust.review_target_type NOT NULL,
  target_id         UUID NOT NULL,
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.reviews IS 'Post-booking reviews. Trust consumes booking.completed; allows review insert. Emits review.created and updates reputation.';
CREATE INDEX IF NOT EXISTS idx_reviews_target ON trust.reviews(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking ON trust.reviews(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_booking_reviewer_target ON trust.reviews(booking_id, reviewer_id, target_type, target_id);

-- 4) Reputation — materialized trust score per user (do not compute live)
CREATE TABLE IF NOT EXISTS trust.reputation (
  user_id              UUID PRIMARY KEY,
  completed_bookings   INTEGER NOT NULL DEFAULT 0,
  positive_reviews     INTEGER NOT NULL DEFAULT 0,
  negative_reviews     INTEGER NOT NULL DEFAULT 0,
  flags_count          INTEGER NOT NULL DEFAULT 0,
  reputation_score     INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.reputation IS 'Materialized reputation. Updated on booking.completed, review created, user.flagged, listing.flagged (if owner).';

-- 5) Suspension state — Trust owns who is suspended; others consume user.suspended / user.unsuspended
CREATE TABLE IF NOT EXISTS trust.user_suspensions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  reason         TEXT NOT NULL,
  suspended_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  suspended_by   UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.user_suspensions IS 'Suspension state. Trust emits user.suspended; auth/listings/booking enforce via policy or event.';
CREATE INDEX IF NOT EXISTS idx_user_suspensions_user ON trust.user_suspensions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_suspensions_expires ON trust.user_suspensions(expires_at);

-- updated_at triggers (flags only; no version column per spec)
CREATE OR REPLACE FUNCTION trust.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_listing_flags_updated ON trust.listing_flags;
CREATE TRIGGER tr_listing_flags_updated
  BEFORE UPDATE ON trust.listing_flags
  FOR EACH ROW EXECUTE PROCEDURE trust.set_updated_at();

DROP TRIGGER IF EXISTS tr_user_flags_updated ON trust.user_flags;
CREATE TRIGGER tr_user_flags_updated
  BEFORE UPDATE ON trust.user_flags
  FOR EACH ROW EXECUTE PROCEDURE trust.set_updated_at();

-- Reputation.updated_at on update (e.g. when recalc)
CREATE OR REPLACE FUNCTION trust.set_reputation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_reputation_updated_at ON trust.reputation;
CREATE TRIGGER tr_reputation_updated_at
  BEFORE UPDATE ON trust.reputation
  FOR EACH ROW EXECUTE PROCEDURE trust.set_reputation_updated_at();
