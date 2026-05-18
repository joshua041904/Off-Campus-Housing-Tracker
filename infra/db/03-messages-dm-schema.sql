-- DM + groups messaging schema + local auth.users mirror (messaging DB only).
-- Required by messaging-service HTTP routes (messages.*, auth.users joins).
-- Apply after 01-messaging-schema.sql on database `messaging`:
--   psql -h 127.0.0.1 -p 5444 -U postgres -d messaging -v ON_ERROR_STOP=1 -f infra/db/03-messages-dm-schema.sql
--
-- auth.users here is a read-through mirror for display names (populated on thread list
-- via gateway x-user-email + upsert, and optionally by auth sync jobs). It is NOT the
-- canonical auth database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS messages;
CREATE SCHEMA IF NOT EXISTS auth;

-- ---------------------------------------------------------------------------
-- auth.users — minimal mirror (UUID PK matches main auth service user ids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  display_username TEXT,
  avatar_url TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email_lower ON auth.users (LOWER(email));

-- ---------------------------------------------------------------------------
-- messages.messages — P2P + group + booking thread_id
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  recipient_id UUID,
  group_id UUID,
  parent_message_id UUID REFERENCES messages.messages(id) ON DELETE SET NULL,
  thread_id UUID,
  message_type TEXT NOT NULL DEFAULT 'General',
  subject TEXT NOT NULL DEFAULT '',
  content TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  recalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages.messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages.messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages.messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages.messages (group_id, created_at);

CREATE OR REPLACE FUNCTION messages.backfill_dm_thread_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.thread_id IS NULL AND NEW.group_id IS NULL THEN
    UPDATE messages.messages SET thread_id = id WHERE id = NEW.id AND thread_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_messages_backfill_thread_id ON messages.messages;
CREATE TRIGGER tr_messages_backfill_thread_id
  AFTER INSERT ON messages.messages
  FOR EACH ROW
  EXECUTE PROCEDURE messages.backfill_dm_thread_id();

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages.group_members (
  group_id UUID NOT NULL REFERENCES messages.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages.group_bans (
  group_id UUID NOT NULL REFERENCES messages.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  banned_by UUID NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages.user_archived_threads (
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE IF NOT EXISTS messages.user_deleted_threads (
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE IF NOT EXISTS messages.message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_path TEXT,
  thumbnail_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  file_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON messages.message_attachments (message_id);

-- ---------------------------------------------------------------------------
-- External contact (in-app queue; delivery provider optional)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages.external_contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  listing_id UUID,
  recipient_email TEXT,
  recipient_phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  contact_method TEXT NOT NULL CHECK (contact_method IN ('email', 'sms')),
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_contact_sender ON messages.external_contact_requests (sender_id, created_at DESC);
