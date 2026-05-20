-- Message emoji reactions (Slack-style: one row per message + user + emoji).
-- Apply on database `messaging` after 03-messages-dm-schema.sql.
--   psql … -d messaging -v ON_ERROR_STOP=1 -f infra/db/21-messaging-message-reactions.sql

CREATE TABLE IF NOT EXISTS messages.message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_unique_user_emoji UNIQUE (message_id, user_id, emoji),
  CONSTRAINT message_reactions_emoji_nonempty CHECK (length(trim(emoji)) > 0),
  CONSTRAINT message_reactions_emoji_short CHECK (char_length(emoji) <= 32)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON messages.message_reactions (message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user_id ON messages.message_reactions (user_id);
