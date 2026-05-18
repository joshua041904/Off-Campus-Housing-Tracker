-- Community forum tables on listings DB (see scripts/run-listings-community-migrations.sh).
CREATE TABLE IF NOT EXISTS listings.community_posts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id           UUID NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  flair               TEXT NOT NULL DEFAULT 'general',
  author_display_name TEXT,
  author_username     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_created
  ON listings.community_posts (created_at DESC);

CREATE TABLE IF NOT EXISTS listings.community_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id             UUID NOT NULL REFERENCES listings.community_posts (id) ON DELETE CASCADE,
  author_id           UUID NOT NULL,
  parent_comment_id   UUID REFERENCES listings.community_comments (id) ON DELETE CASCADE,
  body                TEXT NOT NULL,
  author_display_name TEXT,
  author_username     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_comments_post
  ON listings.community_comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS listings.community_post_votes (
  post_id    UUID NOT NULL REFERENCES listings.community_posts (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- Legacy DBs may have created this table before user_id existed; align before indexes.
ALTER TABLE listings.community_post_votes ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE listings.community_post_votes ADD COLUMN IF NOT EXISTS value SMALLINT;
ALTER TABLE listings.community_post_votes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_community_post_votes_user
  ON listings.community_post_votes (user_id);

CREATE TABLE IF NOT EXISTS listings.community_comment_votes (
  comment_id UUID NOT NULL REFERENCES listings.community_comments (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

ALTER TABLE listings.community_comment_votes ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE listings.community_comment_votes ADD COLUMN IF NOT EXISTS value SMALLINT;
ALTER TABLE listings.community_comment_votes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_community_comment_votes_user
  ON listings.community_comment_votes (user_id);
