-- Soft delete + anonymization columns (see docs/design/ACCOUNT_DELETION_DISTRIBUTED_MODEL.md)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deletion_state VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS display_username VARCHAR(128);

ALTER TABLE auth.users ALTER COLUMN email DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_deleted ON auth.users (is_deleted) WHERE is_deleted = true;
