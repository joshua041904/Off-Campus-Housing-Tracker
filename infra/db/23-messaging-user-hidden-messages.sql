-- Per-user hide: message stays for others, omitted from this user's thread view.
-- Apply: psql … -d messaging -v ON_ERROR_STOP=1 -f infra/db/23-messaging-user-hidden-messages.sql
CREATE TABLE IF NOT EXISTS messages.user_hidden_messages (
  user_id UUID NOT NULL,
  message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_user_hidden_messages_user
  ON messages.user_hidden_messages (user_id);
