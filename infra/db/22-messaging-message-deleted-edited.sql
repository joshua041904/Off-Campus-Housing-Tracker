-- Soft-delete + edit audit for messages.messages (messaging DB).
-- Apply: psql … -d messaging -v ON_ERROR_STOP=1 -f infra/db/22-messaging-message-deleted-edited.sql
ALTER TABLE messages.messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE messages.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_messages_deleted_at
  ON messages.messages (deleted_at)
  WHERE deleted_at IS NOT NULL;
