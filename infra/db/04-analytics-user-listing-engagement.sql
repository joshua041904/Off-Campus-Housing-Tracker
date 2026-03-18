-- Read model for recommendation: per (user, listing) engagement (messages_sent, bookings).
-- Consumed from MessageSentV1 (and booking events). Used by analytics messagingConsumer stub.

CREATE TABLE IF NOT EXISTS analytics.user_listing_engagement (
  user_id              UUID NOT NULL,
  listing_id           UUID NOT NULL,
  messages_sent         INTEGER NOT NULL DEFAULT 0,
  bookings              INTEGER NOT NULL DEFAULT 0,
  last_interaction_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

COMMENT ON TABLE analytics.user_listing_engagement IS
  'Per (user, listing) engagement: messages_sent, bookings. Updated by MessageSentV1 and booking consumers.';

CREATE INDEX IF NOT EXISTS idx_user_listing_engagement_listing
  ON analytics.user_listing_engagement(listing_id);
