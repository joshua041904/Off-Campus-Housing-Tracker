-- Legacy listings DBs may have community_post_votes keyed by (post_id, voter_id) while
-- listings-service expects (post_id, user_id) for INSERT ... ON CONFLICT (post_id, user_id).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'listings'
      AND table_name = 'community_post_votes'
      AND column_name = 'voter_id'
  ) THEN
    UPDATE listings.community_post_votes SET user_id = voter_id WHERE user_id IS NULL;

    ALTER TABLE listings.community_post_votes DROP CONSTRAINT IF EXISTS community_post_votes_pkey;

    ALTER TABLE listings.community_post_votes DROP COLUMN voter_id;

    ALTER TABLE listings.community_post_votes ALTER COLUMN user_id SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'community_post_votes_pkey'
        AND conrelid = 'listings.community_post_votes'::regclass
    ) THEN
      ALTER TABLE listings.community_post_votes
        ADD CONSTRAINT community_post_votes_pkey PRIMARY KEY (post_id, user_id);
    END IF;
  END IF;
END
$$;
