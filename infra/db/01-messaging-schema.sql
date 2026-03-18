-- Messaging service DB: WhatsApp-style conversations, participants, messages, read/archive state.
-- Run against database 'messaging' on port 5444:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5444 -U postgres -d messaging -f infra/db/01-messaging-schema.sql
--
-- Messaging owns: conversations, messages, read state (last_read_at), archive state, soft deletes.
-- It does NOT: validate booking status in its DB (call booking via gRPC if needed), update booking or trust DB.
-- Events emitted: message.sent, message.deleted (for analytics/notification). Messaging is synchronous over gRPC.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS messaging;

-- 1) Conversations — optionally tied to a listing (tenant + landlord); flexible for 2+ participants
CREATE TABLE IF NOT EXISTS messaging.conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE messaging.conversations IS 'Conversation container. Optionally scoped by listing_id. Duplicate prevention via app-layer or conversation_key.';
CREATE INDEX IF NOT EXISTS idx_conversations_listing ON messaging.conversations(listing_id);

-- Optional: unique key to prevent duplicate conversations (e.g. hash(listing_id || tenant_id || landlord_id))
ALTER TABLE messaging.conversations ADD COLUMN IF NOT EXISTS conversation_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_key_unique
  ON messaging.conversations(conversation_key)
  WHERE conversation_key IS NOT NULL;

-- 2) Conversation participants — per-user state: archive, delete, last read
CREATE TABLE IF NOT EXISTS messaging.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES messaging.conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived        BOOLEAN NOT NULL DEFAULT false,
  deleted         BOOLEAN NOT NULL DEFAULT false,
  last_read_at    TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

COMMENT ON TABLE messaging.conversation_participants IS 'Per-user conversation state. last_read_at drives read receipts; MarkAsRead RPC updates it (optionally up to a given message_id). Archive/delete are per-user; never delete conversation globally.';
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
  ON messaging.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_archived_deleted
  ON messaging.conversation_participants(user_id, archived, deleted)
  WHERE deleted = false;

-- 3) Messages — soft delete only (set deleted_at; app replaces body with "This message was deleted")
CREATE TABLE IF NOT EXISTS messaging.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES messaging.conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL,
  body            TEXT,
  message_type    TEXT NOT NULL DEFAULT 'text',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1
);

COMMENT ON TABLE messaging.messages IS 'Messages are soft-deleted (deleted_at). Never hard delete unless admin purge. Unread = count where created_at > participant.last_read_at AND sender_id != current user AND deleted_at IS NULL.';
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messaging.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messaging.messages(sender_id, created_at DESC);

-- updated_at trigger for conversations
CREATE OR REPLACE FUNCTION messaging.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_conversations_updated ON messaging.conversations;
CREATE TRIGGER tr_conversations_updated
  BEFORE UPDATE ON messaging.conversations
  FOR EACH ROW EXECUTE PROCEDURE messaging.set_updated_at();

-- On message update: set edited_at and increment version (for edit/soft-delete flows)
CREATE OR REPLACE FUNCTION messaging.set_message_edited()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.body IS DISTINCT FROM NEW.body OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    NEW.edited_at = now();
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_messages_edited ON messaging.messages;
CREATE TRIGGER tr_messages_edited
  BEFORE UPDATE ON messaging.messages
  FOR EACH ROW EXECUTE PROCEDURE messaging.set_message_edited();
