-- Allowed flair values must match COMMUNITY_FLAIR_SET in listings-service http-server.
ALTER TABLE listings.community_posts DROP CONSTRAINT IF EXISTS community_posts_flair_check;
ALTER TABLE listings.community_posts
  ADD CONSTRAINT community_posts_flair_check
  CHECK (flair IN ('landlord', 'renter', 'announcement', 'general'));
