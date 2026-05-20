-- Add username mirror column for messaging DB auth.users (optional; populated by thread-list upsert).
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS username TEXT;
