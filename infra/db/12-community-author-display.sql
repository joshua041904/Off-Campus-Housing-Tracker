-- Snapshot columns are created on 07-community-posts.sql; keep file for ordering / manual ALTERs.
ALTER TABLE listings.community_posts ADD COLUMN IF NOT EXISTS author_display_name TEXT;
ALTER TABLE listings.community_posts ADD COLUMN IF NOT EXISTS author_username TEXT;
ALTER TABLE listings.community_comments ADD COLUMN IF NOT EXISTS author_display_name TEXT;
ALTER TABLE listings.community_comments ADD COLUMN IF NOT EXISTS author_username TEXT;
